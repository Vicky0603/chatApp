import { KeyValueStore } from '../../src/storage/key-value-store';

export class FakeKeyValueStore extends KeyValueStore {
  private readonly values = new Map<string, string>();

  async get<T>(key: string): Promise<T | null> {
    const raw = this.values.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

