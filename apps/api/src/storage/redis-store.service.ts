import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createClient } from 'redis';
import { ServiceError } from '../common/service-error';
import { KeyValueStore } from './key-value-store';

type RedisClient = ReturnType<typeof createClient>;

@Injectable()
export class RedisStoreService
  extends KeyValueStore
  implements OnModuleDestroy
{
  private client: RedisClient | null = null;
  private connectPromise: Promise<RedisClient> | null = null;

  async get<T>(key: string): Promise<T | null> {
    try {
      const client = await this.getClient();
      const value = await client.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch (error) {
      throw new ServiceError(
        'REDIS_UNAVAILABLE',
        'Session store unavailable',
        error,
      );
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      const client = await this.getClient();
      await client.set(key, JSON.stringify(value), {
        EX: ttlSeconds,
      });
    } catch (error) {
      throw new ServiceError(
        'REDIS_UNAVAILABLE',
        'Session store unavailable',
        error,
      );
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const client = await this.getClient();
      await client.del(key);
    } catch (error) {
      throw new ServiceError(
        'REDIS_UNAVAILABLE',
        'Session store unavailable',
        error,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  private async getClient(): Promise<RedisClient> {
    if (this.client?.isOpen) {
      return this.client;
    }

    if (!this.connectPromise) {
      const client = createClient({
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      });
      this.connectPromise = client
        .connect()
        .then(() => {
          this.client = client;
          return client;
        })
        .catch((error) => {
          this.connectPromise = null;
          throw new ServiceError(
            'REDIS_UNAVAILABLE',
            'Session store unavailable',
            error,
          );
        });
    }

    return this.connectPromise;
  }
}
