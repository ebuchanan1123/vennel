import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { asyncHandler } from '../middleware/async-handler.js';
import { HttpError } from '../middleware/error-handler.js';
import {
  archiveNoteSchema,
  callNoteBodySchema,
  callNoteUpdateSchema,
  noteRevisionSchema,
  reviewNoteSchema,
} from '../schemas/call-note.schema.js';
import {
  customerBodySchema,
  recordParamsSchema,
  workspaceParamsSchema,
} from '../schemas/workspace.schema.js';
import {
  analyzeCallNote,
  archiveCallNote,
  createCallNote,
  getCallNote,
  listCallNotes,
  updateCallNote,
} from '../services/call-note.service.js';
import { reviewCallNote } from '../services/note-review.service.js';
import { transcribeCallSummary } from '../services/note-extraction.service.js';
import { currentAccount } from '../middleware/account-access.js';

export const callNotesRouter = Router({ mergeParams: true });
const audioTypes = new Map([
  ['audio/webm', 'webm'],
  ['audio/mp4', 'm4a'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/m4a', 'm4a'],
]);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 1, fieldSize: 4096 },
  fileFilter: (_req, file, callback) => {
    if (!audioTypes.has(file.mimetype.split(';')[0] ?? ''))
      callback(new HttpError(415, 'Use a supported audio recording, or enter a text note.'));
    else callback(null, true);
  },
});
const audioContext = z
  .object({
    customerId: z.string().min(1).nullable(),
    leadId: z.string().min(1).nullable(),
    direction: z.enum(['INBOUND', 'OUTBOUND']),
    occurredAt: z.string().datetime({ offset: true }),
    phone: customerBodySchema.shape.phone,
  })
  .strict();

callNotesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res.json(await listCallNotes(companyId));
  }),
);
callNotesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    res
      .status(201)
      .json(
        await createCallNote(
          companyId,
          callNoteBodySchema.parse(req.body),
          'TEXT',
          currentAccount(req).id,
        ),
      );
  }),
);
callNotesRouter.post(
  '/transcribe',
  upload.single('audio'),
  asyncHandler(async (req, res) => {
    const { companyId } = workspaceParamsSchema.parse(req.params);
    const file = req.file;
    if (!file?.buffer.length)
      throw new HttpError(400, 'Record a short voice summary or enter text.');
    try {
      const raw: unknown = req.body;
      const form = z.object({ metadata: z.string().min(1) }).parse(raw);
      let metadata: unknown;
      try {
        metadata = JSON.parse(form.metadata);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new HttpError(400, 'Audio-note context is invalid.');
      }
      const context = audioContext.parse(metadata);
      const mimeType = file.mimetype.split(';')[0] ?? '';
      const text = await transcribeCallSummary(
        companyId,
        file.buffer,
        mimeType,
        `call-summary.${audioTypes.get(mimeType) ?? 'webm'}`,
      );
      res
        .status(201)
        .json(
          await createCallNote(companyId, { ...context, text }, 'VOICE', currentAccount(req).id),
        );
    } finally {
      file.buffer.fill(0);
    }
  }),
);
callNotesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    res.json(await getCallNote(companyId, id));
  }),
);
callNotesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    const body = callNoteUpdateSchema.parse(req.body);
    res.json(await updateCallNote(companyId, id, body.revision, body.note, currentAccount(req).id));
  }),
);
callNotesRouter.post(
  '/:id/analyze',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    res.json(
      await analyzeCallNote(
        companyId,
        id,
        noteRevisionSchema.parse(req.body).revision,
        currentAccount(req).id,
      ),
    );
  }),
);
callNotesRouter.post(
  '/:id/review',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    res.json(
      await reviewCallNote(companyId, id, reviewNoteSchema.parse(req.body), currentAccount(req).id),
    );
  }),
);
callNotesRouter.patch(
  '/:id/archive',
  asyncHandler(async (req, res) => {
    const { companyId, id } = recordParamsSchema.parse(req.params);
    const body = archiveNoteSchema.parse(req.body);
    res.json(
      await archiveCallNote(companyId, id, body.revision, body.isArchived, currentAccount(req).id),
    );
  }),
);
