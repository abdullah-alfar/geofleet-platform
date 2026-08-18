import { FetchError } from 'ofetch';
import type { ApiErrorBody } from '~/types/api';

/** Normalizes any failure from a call to core-api into one shape the UI
 * can render consistently — `code`/`message` straight off the server's
 * own envelope (App\Support\ApiError, same shape admin-api's own filter
 * produces) where available, a synthetic `network_error`/`unknown_error`
 * code otherwise (server unreachable, timeout, or a non-HTTP failure). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly correlationId: string | null;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error.code;
    this.correlationId = body.error.correlation_id;
    this.details = body.error.details;
  }
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof FetchError) {
    const status = error.response?.status ?? 0;
    const body = error.data as ApiErrorBody | undefined;

    if (body?.error?.message) {
      return new ApiError(status, body);
    }

    return new ApiError(status, {
      error: {
        code: 'network_error',
        message: error.message || 'The server could not be reached.',
        correlation_id: null,
      },
    });
  }

  return new ApiError(0, {
    error: {
      code: 'unknown_error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred.',
      correlation_id: null,
    },
  });
}
