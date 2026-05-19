export type ServiceErrorCode =
  | 'REDIS_UNAVAILABLE'
  | 'LLM_UNAVAILABLE'
  | 'LLM_RATE_LIMITED'
  | 'INTERNAL_ERROR';

export class ServiceError extends Error {
  constructor(
    public readonly code: ServiceErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'ServiceError';
  }
}

