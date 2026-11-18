import type { NextRequest } from 'next/server';
import { forwardApiRequest } from '../../../../lib/server-api-proxy';

async function proxy(request: NextRequest, { params }: { params: Promise<{ all: string[] }> }) {
  return forwardApiRequest(request, ['api', 'auth', ...(await params).all]);
}
export const GET = proxy;
export const POST = proxy;
