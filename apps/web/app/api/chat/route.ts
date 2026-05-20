import { cookies } from 'next/headers';
import { BACKEND_URL, RATE_LIMIT_COOKIE, SESSION_COOKIE } from '@/lib/config';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;

function parseRateCookie(
  raw: string | undefined,
  sessionId: string,
  now: number,
): number[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as {
      sessionId?: string;
      timestamps?: number[];
    };

    if (parsed.sessionId !== sessionId) {
      return [];
    }

    return (parsed.timestamps ?? []).filter(
      (timestamp) => now - timestamp < WINDOW_MS,
    );
  } catch {
    return [];
  }
}

function rateCookieValue(sessionId: string, timestamps: number[]): string {
  const payload = encodeURIComponent(
    JSON.stringify({
      sessionId,
      timestamps,
    }),
  );
  return `${RATE_LIMIT_COOKIE}=${payload}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600`;
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionId) {
    return Response.json({ sessionExpired: true }, { status: 200 });
  }

  const now = Date.now();
  const timestamps = parseRateCookie(
    cookieStore.get(RATE_LIMIT_COOKIE)?.value,
    sessionId,
    now,
  );
  if (timestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    const retryAfterSeconds = Math.ceil(
      (timestamps[0] + WINDOW_MS - now) / 1000,
    );
    return Response.json(
      { error: 'Rate limit exceeded' },
      {
        status: 429,
        headers: {
          'Retry-After': String(retryAfterSeconds),
          'Set-Cookie': rateCookieValue(sessionId, timestamps),
        },
      },
    );
  }

  const nextTimestamps = [...timestamps, now];
  const body = await request.text();
  const upstream = await fetch(`${BACKEND_URL}/chat/${sessionId}/message`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(request.headers.get('Last-Event-ID')
        ? { 'Last-Event-ID': request.headers.get('Last-Event-ID') as string }
        : {}),
    },
    body,
    cache: 'no-store',
  }).catch(() => null);

  if (!upstream) {
    return Response.json(
      { error: 'Upstream unavailable' },
      {
        status: 502,
        headers: {
          'Set-Cookie': rateCookieValue(sessionId, nextTimestamps),
        },
      },
    );
  }

  if (upstream.status === 404 || upstream.status === 410) {
    return Response.json(
      { sessionExpired: true },
      {
        status: 200,
        headers: {
          'Set-Cookie': rateCookieValue(sessionId, nextTimestamps),
        },
      },
    );
  }

  if (!upstream.ok || !upstream.body) {
    return Response.json(
      { error: 'Upstream unavailable' },
      {
        status: 502,
        headers: {
          'Set-Cookie': rateCookieValue(sessionId, nextTimestamps),
        },
      },
    );
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Set-Cookie': rateCookieValue(sessionId, nextTimestamps),
    },
  });
}
