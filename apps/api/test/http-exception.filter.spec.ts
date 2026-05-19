import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { ApiExceptionFilter } from '../src/common/http-exception.filter';
import { ServiceError } from '../src/common/service-error';

function createHost(response: { status: jest.Mock; json: jest.Mock }) {
  return {
    switchToHttp() {
      return {
        getResponse() {
          return response;
        },
      };
    },
  } as ArgumentsHost;
}

describe('ApiExceptionFilter', () => {
  const filter = new ApiExceptionFilter();

  it('maps service availability failures to structured 503 responses', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    filter.catch(
      new ServiceError('REDIS_UNAVAILABLE', 'Session store unavailable'),
      createHost(response),
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(response.json).toHaveBeenCalledWith({
      error: 'Session store unavailable',
      code: 'REDIS_UNAVAILABLE',
    });
  });

  it('passes through regular HttpExceptions', () => {
    const response = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    filter.catch(
      new HttpException({ error: 'Session not found' }, HttpStatus.NOT_FOUND),
      createHost(response),
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(response.json).toHaveBeenCalledWith({ error: 'Session not found' });
  });
});
