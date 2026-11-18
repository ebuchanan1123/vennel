const defaultApiBaseUrl = 'http://localhost:4000';

export async function GET(): Promise<Response> {
  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? defaultApiBaseUrl;

  try {
    const upstream = await fetch(`${apiBaseUrl}/health`, {
      cache: 'no-store',
    });

    const body = await upstream.text();
    const contentType = upstream.headers.get('content-type') ?? 'application/json; charset=utf-8';

    return new Response(body, {
      status: upstream.status,
      headers: {
        'content-type': contentType,
      },
    });
  } catch (error) {
    console.error('Dashboard health proxy failed', error);

    return Response.json(
      {
        ok: false,
        error: 'API health check failed',
      },
      { status: 502 },
    );
  }
}
