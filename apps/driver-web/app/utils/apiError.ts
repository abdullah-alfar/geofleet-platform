import { FetchError } from 'ofetch';
import type { ApiErrorBody } from '~/types/api';

/** Normalizes any failure from core-api, dispatch-service, or
 * location-service into one shape the UI can render consistently. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.error.code;
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
      },
    });
  }

  return new ApiError(0, {
    error: {
      code: 'unknown_error',
      message: error instanceof Error ? error.message : 'An unexpected error occurred.',
    },
  });
}
