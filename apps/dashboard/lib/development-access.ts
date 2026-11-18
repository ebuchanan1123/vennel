const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isLocalAddress(value: string): boolean {
  return loopbackHosts.has(value) || value === '::ffff:127.0.0.1';
}

export function isLocalDevelopmentRequest(url: URL, headers: Headers): boolean {
  if (!loopbackHosts.has(url.hostname)) return false;
  const forwardedHost = headers.get('x-forwarded-host');
  if (forwardedHost) {
    try {
      if (!loopbackHosts.has(new URL(`http://${forwardedHost}`).hostname)) return false;
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return false;
    }
  }
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor && !forwardedFor.split(',').every((address) => isLocalAddress(address.trim())))
    return false;
  const origin = headers.get('origin');
  if (origin && origin !== url.origin) return false;
  return headers.get('sec-fetch-site') !== 'cross-site';
}

export function internalApiUrl(): string {
  const value = process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4000';
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'API_INTERNAL_URL must be a fixed HTTP(S) origin without credentials or a path.',
    );
  }
  return url.origin;
}

export function applicationOrigin(): string {
  return new URL(process.env.DASHBOARD_BASE_URL ?? 'http://localhost:3000').origin;
}
