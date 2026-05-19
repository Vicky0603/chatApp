export type ChatRole = 'user' | 'assistant';

export interface Turn {
  role: ChatRole;
  content: string;
}

export interface ChatSession {
  id: string;
  turns: Turn[];
  lastActiveAt: number;
}

