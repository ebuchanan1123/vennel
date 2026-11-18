'use client';

import { useEffect, useRef, useState } from 'react';

import { errorMessage, transcribeCallNote, type CallNote, type CallNoteInput } from '../lib/api';
import { Icon } from './icon';
import { FormError } from './ui';

export function VoiceNoteCapture({
  companyId,
  metadata,
  onTranscribed,
}: {
  companyId: string;
  metadata: () => Omit<CallNoteInput, 'text' | 'newCustomer'>;
  onTranscribed: (note: CallNote) => void;
}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<BlobPart[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function release() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state !== 'inactive') recorder.current.stop();
      }
      release();
      chunks.current = [];
    };
  }, []);

  async function start() {
    setError('');
    try {
      const context = metadata();
      if (
        !globalThis.isSecureContext ||
        !navigator.mediaDevices?.getUserMedia ||
        !globalThis.MediaRecorder
      ) {
        throw new Error(
          'Voice capture is unavailable in this browser. Enter a text summary instead.',
        );
      }
      const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      if (!mimeType)
        throw new Error('This browser has no supported audio format. Use the text note field.');
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        release();
        return;
      }
      const capture = new MediaRecorder(stream.current, { mimeType });
      recorder.current = capture;
      chunks.current = [];
      capture.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      capture.onerror = () => {
        capture.onstop = null;
        if (capture.state !== 'inactive') capture.stop();
        release();
        chunks.current = [];
        if (mounted.current) {
          setRecording(false);
          setError('Recording was interrupted. Enter text or try again.');
        }
      };
      capture.onstop = async () => {
        release();
        setRecording(false);
        const audio = new Blob(chunks.current, { type: mimeType });
        chunks.current = [];
        if (!mounted.current || !audio.size) return;
        setBusy(true);
        try {
          const note = await transcribeCallNote(companyId, audio, context);
          if (mounted.current) onTranscribed(note);
        } catch (cause) {
          if (mounted.current) setError(errorMessage(cause));
        } finally {
          if (mounted.current) setBusy(false);
        }
      };
      capture.start();
      setRecording(true);
      timer.current = setTimeout(() => {
        if (capture.state !== 'inactive') capture.stop();
      }, 120000);
    } catch (cause) {
      release();
      setError(
        cause instanceof DOMException && cause.name === 'NotAllowedError'
          ? 'Microphone permission was denied. You can still type your call note.'
          : errorMessage(cause),
      );
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={busy}
        className={recording ? 'btn-secondary border-rose-200 text-rose-700' : 'btn-secondary'}
        onClick={() => {
          if (recording) recorder.current?.stop();
          else void start();
        }}
      >
        <Icon name={recording ? 'stop' : 'mic'} width={17} height={17} />
        {busy ? 'Transcribing...' : recording ? 'Stop & transcribe' : 'Dictate a summary'}
      </button>
      <p className="text-[11px] leading-relaxed text-steel">
        Record only your post-call summary, up to two minutes. Calls are never recorded. Audio is
        sent to OpenAI for transcription and is not retained by this application.
      </p>
      <FormError message={error} />
    </div>
  );
}
