import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { ServiceError } from './service-error';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      response.status(status).json(payload);
      return;
    }

    if (exception instanceof ServiceError) {
      const status =
        exception.code === 'LLM_RATE_LIMITED'
          ? HttpStatus.TOO_MANY_REQUESTS
          : exception.code === 'REDIS_UNAVAILABLE' || exception.code === 'LLM_UNAVAILABLE'
            ? HttpStatus.SERVICE_UNAVAILABLE
            : HttpStatus.INTERNAL_SERVER_ERROR;

      this.logger.error(exception.message, this.describeCause(exception.cause));
      response.status(status).json({
        error: exception.message,
        code: exception.code,
      });
      return;
    }

    this.logger.error('Unhandled exception', this.describeCause(exception));
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
    });
  }

  private describeCause(cause: unknown) {
    if (cause instanceof Error) {
      return cause.stack;
    }

    if (typeof cause === 'string') {
      return cause;
    }

    try {
      return JSON.stringify(cause);
    } catch {
      return String(cause);
    }
  }
}

