/** @jest-environment node */

jest.mock('next/headers', () => ({
  cookies: jest.fn(),
}));

import { cookies } from 'next/headers';
import { POST } from '@/app/api/chat/route';

const mockedCookies = cookies as jest.Mock;
const encoder = new TextEncoder();

describe('/api/chat route', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('proxies the stream correctly', async () => {
    mockedCookies.mockResolvedValue({
      get: (name: string) =>
        name === 'chat_session'
          ? { value: 'session-123' }
          : { value: encodeURIComponent(JSON.stringify({ sessionId: 'session-123', timestamps: [] })) },
    });

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('id: 0\ndata: {"token":"Hi"}\n\n'));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        },
      ),
    );

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      }),
    );

    expect(response.headers.get('Content-Type')).toContain('text/event-stream');
    expect(await response.text()).toContain('"token":"Hi"');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3001/chat/session-123/message',
      expect.objectContaining({
        cache: 'no-store',
      }),
    );
  });

  it('returns sessionExpired on 410 from NestJS', async () => {
    mockedCookies.mockResolvedValue({
      get: (name: string) =>
        name === 'chat_session'
          ? { value: 'session-123' }
          : undefined,
    });

    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(null, { status: 410 }),
    );

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      }),
    );

    expect(await response.json()).toEqual({ sessionExpired: true });
  });

  it('returns sessionExpired when the session cookie is missing', async () => {
    mockedCookies.mockResolvedValue({
      get: () => undefined,
    });

    const fetchSpy = jest.spyOn(global, 'fetch');
    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      }),
    );

    expect(await response.json()).toEqual({ sessionExpired: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 502 on non-session upstream failures', async () => {
    mockedCookies.mockResolvedValue({
      get: (name: string) =>
        name === 'chat_session'
          ? { value: 'session-123' }
          : undefined,
    });

    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'bad gateway' }), { status: 500 }),
    );

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      }),
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Upstream unavailable' });
  });

  it('forwards Last-Event-ID on reconnect', async () => {
    mockedCookies.mockResolvedValue({
      get: (name: string) =>
        name === 'chat_session'
          ? { value: 'session-123' }
          : undefined,
    });

    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"done":true,"turnIndex":1}\n\n'));
            controller.close();
          },
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        },
      ),
    );

    await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        headers: {
          'Last-Event-ID': '3',
        },
        body: JSON.stringify({ message: 'Hello' }),
      }),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:3001/chat/session-123/message',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Last-Event-ID': '3',
        }),
      }),
    );
  });

  it('returns 429 with Retry-After when the sliding window is exceeded', async () => {
    const timestamps = Array.from({ length: 20 }, (_, index) => Date.now() - index * 1000);
    mockedCookies.mockResolvedValue({
      get: (name: string) =>
        name === 'chat_session'
          ? { value: 'session-123' }
          : {
              value: encodeURIComponent(
                JSON.stringify({ sessionId: 'session-123', timestamps }),
              ),
            },
    });

    const response = await POST(
      new Request('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: 'Hello' }),
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBeTruthy();
    expect(await response.json()).toEqual({ error: 'Rate limit exceeded' });
  });
});
