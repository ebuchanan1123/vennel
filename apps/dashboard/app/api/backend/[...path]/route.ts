import type { NextRequest } from 'next/server';
import { forwardApiRequest } from '../../../../lib/server-api-proxy';

async function proxy(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  return forwardApiRequest(request, (await params).path);
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
