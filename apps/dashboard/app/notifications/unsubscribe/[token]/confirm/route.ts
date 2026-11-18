import { NextResponse } from 'next/server';
import { internalApiUrl } from '../../../../../lib/development-access';

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(token))
    return NextResponse.json({ error: 'Invalid link.' }, { status: 400 });
  const response = await fetch(
    `${internalApiUrl()}/api/notifications/unsubscribe/${encodeURIComponent(token)}`,
    { method: 'POST' },
  );
  return new NextResponse(response.body, {
    status: response.status,
    headers: { 'content-type': 'application/json' },
  });
}
