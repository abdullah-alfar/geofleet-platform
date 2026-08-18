/** Every core-api success response is wrapped `{ data: ... }` (Laravel's
 * default JsonResource envelope). Register/login additionally carry a
 * `meta.token`; device registration additionally carries `meta.device_token`. */
export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiEnvelopeWithMeta<T, M = Record<string, unknown>> {
  data: T;
  meta: M;
}

/** core-api's error envelope (App\Support\ApiError). dispatch-service and
 * location-service (Go) render the same `{error:{code,message}}` shape —
 * see apps/dispatch-service/internal/httpapi/respond.go and
 * apps/location-service's equivalent — just without `correlation_id`/
 * `details`, which is why those are optional here. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    correlation_id?: string | null;
    details?: unknown;
  };
}
