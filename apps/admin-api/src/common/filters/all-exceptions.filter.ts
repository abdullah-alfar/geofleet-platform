import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AppConfig } from '../../config/configuration';

const STATUS_CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthenticated',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'unprocessable',
  429: 'rate_limited',
};

/**
 * Renders every uncaught exception into one consistent envelope —
 * `{ error: { code, message, correlation_id } }` — mirroring core-api's
 * App\Support\ApiError so admin-web never has to special-case which
 * backend produced an error. Never leaks a stack trace or raw error
 * message to the client outside development.
 */
@Injectable()
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const correlationId = request.correlationId ?? null;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'server_error';
    let message = 'An unexpected error occurred.';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = STATUS_CODES[status] ?? 'http_error';
      message = exception.message || 'Request failed.';

      const body = exception.getResponse();
      if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        if (Array.isArray(b.message)) {
          // class-validator's BadRequestException shape.
          code = 'validation_failed';
          message = 'The given data was invalid.';
          details = b.message;
        } else if (typeof b.message === 'string') {
          message = b.message;
        }
      }
    } else {
      const err = exception instanceof Error ? exception : undefined;
      this.logger.error(
        err?.message ?? 'Unhandled non-Error exception',
        err?.stack,
        { correlation_id: correlationId },
      );
      if (!this.config.get('isProduction', { infer: true })) {
        message = err?.message ?? message;
      }
    }

    response.status(status).json({
      error: {
        code,
        message,
        ...(details !== undefined ? { details } : {}),
        correlation_id: correlationId,
      },
    });
  }
}
