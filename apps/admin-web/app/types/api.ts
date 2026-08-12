/** Every admin-api success response is wrapped `{ data: ... }` — see
 * apps/admin-api/src/common/interceptors/response.interceptor.ts. */
export interface ApiEnvelope<T> {
  data: T;
}

export interface PaginatedMeta {
  next_cursor: string | null;
}

/** List endpoints keep `data`/`meta` at the top level rather than nesting
 * under a second `data` key — matches admin-api's own
 * PaginatedResponse<T> shape exactly (cursor pagination, Phase 5). */
export interface PaginatedResponse<T> {
  data: T[];
  meta: PaginatedMeta;
}

/** Every admin-api error response — see
 * apps/admin-api/src/common/filters/all-exceptions.filter.ts. Also the
 * shape core-api's own App\Support\ApiError renders (the login call this
 * app makes directly to core-api uses the same envelope). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    correlation_id: string | null;
    details?: unknown;
  };
}
