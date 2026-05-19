import { cookies } from 'next/headers';
import { BACKEND_URL, RATE_LIMIT_COOKIE, SESSION_COOKIE } from '@/lib/config';

export async function POST() {
  const store = await cookies();
  const current = store.get(SESSION_COOKIE)?.value;
  if (current) {
    return Response.json({ sessionId: current });
  }

  const upstream = await fetch(`${BACKEND_URL}/session`, {
    method: 'POST',
    cache: 'no-store',
  });

  if (!upstream.ok) {
    return Response.json({ error: 'Unable to create session' }, { status: 502 });
  }

  const payload = (await upstream.json()) as { sessionId: string };
  store.set(SESSION_COOKIE, payload.sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
  });

  return Response.json(payload, { status: 201 });
}

export async function DELETE() {
  const store = await cookies();
  const sessionId = store.get(SESSION_COOKIE)?.value;

  if (sessionId) {
    await fetch(`${BACKEND_URL}/session/${sessionId}`, {
      method: 'DELETE',
      cache: 'no-store',
    }).catch(() => undefined);
  }

  store.delete(SESSION_COOKIE);
  store.delete(RATE_LIMIT_COOKIE);
  return new Response(null, { status: 204 });
}
