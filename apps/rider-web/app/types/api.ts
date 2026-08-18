/** Every core-api success response is wrapped `{ data: ... }` (Laravel's
 * default JsonResource envelope). Login/register additionally carry a
 * `meta.token` — see ApiEnvelopeWithMeta below. */
export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiEnvelopeWithMeta<T, M = Record<string, unknown>> {
  data: T;
  meta: M;
}

/** Every core-api error response — App\Support\ApiError renders every
 * exception (validation, auth, not-found, ...) into this one shape. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    correlation_id: string | null;
    details?: unknown;
  };
}
