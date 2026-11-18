import { NextResponse, type NextRequest } from 'next/server';
import { applicationOrigin, internalApiUrl } from './development-access';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export async function forwardApiRequest(request: NextRequest, path: string[]) {
  if (path[0] !== 'api' || path.some((part) => part === '..' || part === '.')) {
    return NextResponse.json({ error: 'Unknown API route.' }, { status: 404 });
  }
  const changing = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  if (changing && request.headers.get('origin') !== applicationOrigin()) {
    return NextResponse.json(
      { error: 'Requests must originate from this application.' },
      { status: 403 },
    );
  }
  const contentType = request.headers.get('content-type');
  if (
    changing &&
    request.body &&
    !contentType?.startsWith('application/json') &&
    !contentType?.startsWith('multipart/form-data')
  ) {
    return NextResponse.json({ error: 'Use JSON or an audio multipart upload.' }, { status: 415 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'The upload exceeds the 10 MB limit.' }, { status: 413 });
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        chunks.forEach((part) => part.fill(0));
        return NextResponse.json({ error: 'The upload exceeds the 10 MB limit.' }, { status: 413 });
      }
      chunks.push(chunk.value);
    }
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
    chunk.fill(0);
  }
  try {
    const url = new URL(`${internalApiUrl()}/${path.map(encodeURIComponent).join('/')}`);
    url.search = request.nextUrl.search;
    const response = await fetch(url, {
      method: request.method,
      cache: 'no-store',
      redirect: 'manual',
      headers: {
        ...(contentType ? { 'content-type': contentType } : {}),
        ...(request.headers.get('cookie') ? { cookie: request.headers.get('cookie') ?? '' } : {}),
        ...(request.headers.get('origin') ? { origin: request.headers.get('origin') ?? '' } : {}),
        ...(request.headers.get('user-agent')
          ? { 'user-agent': request.headers.get('user-agent') ?? '' }
          : {}),
      },
      body: size ? body : undefined,
      signal: AbortSignal.timeout(90000),
    });
    const headers = new Headers({
      'content-type': response.headers.get('content-type') ?? 'application/json',
      'cache-control': 'no-store',
      vary: 'Cookie',
    });
    for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie);
    const location = response.headers.get('location');
    if (location) {
      const redirect = new URL(location, applicationOrigin());
      if (redirect.origin !== applicationOrigin())
        return NextResponse.json(
          { error: 'The API returned an untrusted redirect.' },
          { status: 502 },
        );
      headers.set('location', redirect.toString());
    }
    return new NextResponse(response.body, { status: response.status, headers });
  } catch (error) {
    console.error('API gateway request failed', {
      errorType: error instanceof Error ? error.name : 'Unknown',
    });
    return NextResponse.json(
      { error: 'The API request failed. Check the backend and try again.' },
      { status: 502 },
    );
  } finally {
    body.fill(0);
  }
}
