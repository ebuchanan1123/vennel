import { NextResponse, type NextRequest } from 'next/server';

import { applicationOrigin, isLocalDevelopmentRequest } from './lib/development-access';

export function middleware(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete('x-workspace-public-view');
  headers.set('x-workspace-path', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  if (request.nextUrl.pathname.startsWith('/notifications/unsubscribe/')) {
    headers.set('x-workspace-public-view', 'notifications');
    return NextResponse.next({ request: { headers } });
  }
  if (
    process.env.NODE_ENV !== 'production' &&
    !isLocalDevelopmentRequest(request.nextUrl, request.headers)
  ) {
    return new NextResponse(
      'This workspace is available only from the local development machine.',
      { status: 403 },
    );
  }
  if (process.env.NODE_ENV === 'production' && request.nextUrl.origin !== applicationOrigin())
    return new NextResponse('Unrecognized application origin.', { status: 403 });
  if (
    /^\/(login|register|forgot-password|reset-password|verify-email|invite)(\/|$)/.test(
      request.nextUrl.pathname,
    )
  )
    headers.set('x-workspace-public-view', 'account');
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|health).*)'],
};
