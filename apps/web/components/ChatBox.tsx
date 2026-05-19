'use client';

import { FormEvent, useOptimistic, useState, useTransition } from 'react';
import { ChatMessage } from '@/lib/types';

class FatalStreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FatalStreamError';
  }
}

const MAX_STREAM_ATTEMPTS = 3;

function parseSseEvents(buffer: string) {
  const events = buffer.split('\n\n');
  return {
    complete: events.slice(0, -1),
    remainder: events.at(-1) ?? '',
  };
}

function parseSseEvent(rawEvent: string) {
  const idLine = rawEvent
    .split('\n')
    .find((entry) => entry.startsWith('id: '));
  const dataLine = rawEvent
    .split('\n')
    .find((entry) => entry.startsWith('data: '));

  return {
    id: idLine ? Number.parseInt(idLine.slice(4), 10) : null,
    payload: dataLine
      ? (JSON.parse(dataLine.slice(6)) as {
          token?: string;
          done?: boolean;
          error?: string;
        })
      : null,
  };
}

export function ChatBox({ initialMessages }: { initialMessages: ChatMessage[] }) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState('');
  const [pendingUser, setPendingUser] = useState<ChatMessage | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [optimisticUser, addOptimisticUser] = useOptimistic(
    pendingUser,
    (_current, next: ChatMessage | null) => next,
  );

  const renderedMessages =
    optimisticUser && !messages.some((message) => message.id === optimisticUser.id)
      ? [...messages, optimisticUser]
      : messages;

  async function ensureSession() {
    const response = await fetch('/api/session', {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Unable to create session');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const messageText = draft.trim();
    if (!messageText || isStreaming) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: messageText,
    };
    const assistantMessage: ChatMessage = {
      id: `assistant-${Date.now()}`,
      role: 'assistant',
      content: '',
    };

    setDraft('');
    setToast(null);
    startTransition(() => {
      setPendingUser(userMessage);
      addOptimisticUser(userMessage);
    });

    try {
      await ensureSession();
      startTransition(() => {
        setMessages((current) => [...current, userMessage, assistantMessage]);
        setPendingUser(null);
        setIsStreaming(true);
      });
      await streamAssistantReply(messageText, assistantMessage.id);
      setIsStreaming(false);
    } catch (error) {
      setPendingUser(null);
      setIsStreaming(false);
      setToast(error instanceof Error ? error.message : 'Request failed');
      startTransition(() => {
        setMessages((current) =>
          current.filter(
            (entry) => entry.id !== userMessage.id && entry.id !== assistantMessage.id,
          ),
        );
      });
    }
  }

  async function streamAssistantReply(
    messageText: string,
    assistantMessageId: string,
  ) {
    const decoder = new TextDecoder();
    let lastEventId: number | null = null;

    for (let attempt = 0; attempt < MAX_STREAM_ATTEMPTS; attempt += 1) {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(lastEventId !== null
            ? { 'Last-Event-ID': String(lastEventId) }
            : {}),
        },
        body: JSON.stringify({ message: messageText }),
      });

      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const payload = (await response.json()) as {
          sessionExpired?: boolean;
          error?: string;
        };
        if (payload.sessionExpired) {
          setToast('Session expired');
          await fetch('/api/session', { method: 'DELETE' });
          window.location.reload();
          return;
        }

        if (response.status === 429) {
          throw new Error(payload.error ?? 'Rate limit exceeded');
        }
      }

      if (!response.ok || !response.body) {
        throw new Error('Streaming failed');
      }

      const reader = response.body.getReader();
      let buffer = '';
      let completed = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const parsed = parseSseEvents(buffer);
          buffer = parsed.remainder;

          for (const rawEvent of parsed.complete) {
            const event = parseSseEvent(rawEvent);
            if (event.id !== null && !Number.isNaN(event.id)) {
              lastEventId = event.id;
            }

            const payload = event.payload;
            if (!payload) {
              continue;
            }

            if (payload.error) {
              throw new FatalStreamError(payload.error);
            }

            if (payload.token) {
              startTransition(() => {
                setMessages((current) =>
                  current.map((entry) =>
                    entry.id === assistantMessageId
                      ? { ...entry, content: entry.content + payload.token }
                      : entry,
                  ),
                );
              });
            }

            if (payload.done) {
              completed = true;
              return;
            }
          }
        }
      } catch (error) {
        if (attempt === MAX_STREAM_ATTEMPTS - 1 || error instanceof FatalStreamError) {
          throw error;
        }
        continue;
      }

      if (completed) {
        return;
      }

      if (attempt === MAX_STREAM_ATTEMPTS - 1) {
        throw new Error('Streaming failed');
      }
    }
  }

  return (
    <section className="chat-shell">
      <header className="hero">
        <h1>Northwind University</h1>
        <p>
          Ask about admissions, departments, housing, scholarships, campus
          policies, and student services.
        </p>
      </header>

      <div className="messages" aria-live="polite">
        {renderedMessages.map((message) => {
          const isLiveAssistant =
            isStreaming &&
            message.role === 'assistant' &&
            message.id === messages.at(-1)?.id;

          return (
            <div
              key={message.id}
              className={`bubble ${
                message.role === 'user' ? 'bubble-user' : 'bubble-assistant'
              }`}
            >
              {message.content}
              {isLiveAssistant ? <span className="cursor">|</span> : null}
            </div>
          );
        })}
      </div>

      <form className="composer" onSubmit={handleSubmit}>
        <label htmlFor="chat-message">Message</label>
        <textarea
          id="chat-message"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about Northwind University"
        />
        <button type="submit" disabled={isStreaming || isPending}>
          Send
        </button>
      </form>

      {toast ? <div className="toast">{toast}</div> : null}
    </section>
  );
}
