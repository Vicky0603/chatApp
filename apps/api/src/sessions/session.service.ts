import {
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ChatSession, Turn } from '../common/chat.types';
import { KeyValueStore } from '../storage/key-value-store';

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const SESSION_TTL_SECONDS = 30 * 60;

@Injectable()
export class SessionService {
  constructor(private readonly store: KeyValueStore) {}

  async create(): Promise<ChatSession> {
    const session: ChatSession = {
      id: randomUUID(),
      turns: [],
      lastActiveAt: Date.now(),
    };

    await this.store.set(this.key(session.id), session, SESSION_TTL_SECONDS);
    return session;
  }

  async get(id: string): Promise<ChatSession> {
    const session = await this.store.get<ChatSession>(this.key(id));
    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (Date.now() - session.lastActiveAt > THIRTY_MINUTES_MS) {
      await this.store.delete(this.key(id));
      throw new GoneException('Session expired');
    }

    session.lastActiveAt = Date.now();
    await this.store.set(this.key(id), session, SESSION_TTL_SECONDS);
    return session;
  }

  async listTurns(id: string): Promise<Turn[]> {
    const session = await this.get(id);
    return [...session.turns];
  }

  async appendUserTurn(id: string, content: string): Promise<void> {
    const session = await this.get(id);
    session.turns.push({ role: 'user', content });
    session.lastActiveAt = Date.now();
    await this.store.set(this.key(id), session, SESSION_TTL_SECONDS);
  }

  async appendAssistantTurn(id: string, content: string): Promise<number> {
    const session = await this.get(id);
    session.turns.push({ role: 'assistant', content });
    session.lastActiveAt = Date.now();
    await this.store.set(this.key(id), session, SESSION_TTL_SECONDS);
    return session.turns.length - 1;
  }

  async delete(id: string): Promise<void> {
    await this.store.delete(this.key(id));
  }

  private key(id: string): string {
    return `session:${id}`;
  }
}
