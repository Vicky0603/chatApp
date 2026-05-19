import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { KeyValueStore } from '../storage/key-value-store';

const STREAM_TTL_SECONDS = 60 * 10;

export interface StreamState {
  requestId: string;
  sessionId: string;
  userMessage: string;
  tokens: string[];
  assistantText: string;
  status: 'streaming' | 'done' | 'error';
  turnIndex?: number;
  error?: string;
  updatedAt: number;
}

@Injectable()
export class StreamStateService {
  constructor(private readonly store: KeyValueStore) {}

  async create(sessionId: string, userMessage: string): Promise<StreamState> {
    const state: StreamState = {
      requestId: randomUUID(),
      sessionId,
      userMessage,
      tokens: [],
      assistantText: '',
      status: 'streaming',
      updatedAt: Date.now(),
    };

    await this.store.set(this.key(sessionId), state, STREAM_TTL_SECONDS);
    return state;
  }

  async get(sessionId: string): Promise<StreamState | null> {
    return this.store.get<StreamState>(this.key(sessionId));
  }

  async appendToken(sessionId: string, token: string): Promise<StreamState | null> {
    const state = await this.get(sessionId);
    if (!state) {
      return null;
    }

    state.tokens.push(token);
    state.assistantText += token;
    state.updatedAt = Date.now();
    await this.store.set(this.key(sessionId), state, STREAM_TTL_SECONDS);
    return state;
  }

  async complete(sessionId: string, turnIndex: number): Promise<void> {
    const state = await this.get(sessionId);
    if (!state) {
      return;
    }

    state.status = 'done';
    state.turnIndex = turnIndex;
    state.updatedAt = Date.now();
    await this.store.set(this.key(sessionId), state, STREAM_TTL_SECONDS);
  }

  async fail(sessionId: string, error: string): Promise<void> {
    const state = await this.get(sessionId);
    if (!state) {
      return;
    }

    state.status = 'error';
    state.error = error;
    state.updatedAt = Date.now();
    await this.store.set(this.key(sessionId), state, STREAM_TTL_SECONDS);
  }

  private key(sessionId: string): string {
    return `stream:${sessionId}`;
  }
}

