import { cookies } from 'next/headers';
import { ChatBox } from '@/components/ChatBox';
import { BACKEND_URL, SESSION_COOKIE } from '@/lib/config';
import { ChatMessage } from '@/lib/types';

async function loadInitialMessages(): Promise<ChatMessage[]> {
  const sessionId = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!sessionId) {
    return [];
  }

  const response = await fetch(`${BACKEND_URL}/chat/${sessionId}`, {
    cache: 'no-store',
  }).catch(() => null);

  if (!response || !response.ok) {
    return [];
  }

  const payload = (await response.json()) as {
    turns: Array<{ role: 'user' | 'assistant'; content: string }>;
  };

  return payload.turns.map((turn, index) => ({
    id: `initial-${index}`,
    role: turn.role,
    content: turn.content,
  }));
}

export default async function Page() {
  const initialMessages = await loadInitialMessages();

  return (
    <main className="page-shell">
      <ChatBox initialMessages={initialMessages} />
    </main>
  );
}

