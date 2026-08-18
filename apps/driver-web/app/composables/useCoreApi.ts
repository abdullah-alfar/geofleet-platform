import type { ApiEnvelope, ApiEnvelopeWithMeta } from '~/types/api';
import { toApiError } from '~/utils/apiError';

type QueryParams = Record<string, string | number | boolean | undefined>;

/** The one place every call to core-api goes through — bearer-token
 * injection (the driver's own Sanctum user token, not the device token)
 * and error normalization. Mirrors apps/rider-web's useCoreApi. */
export function useCoreApi() {
  const config = useRuntimeConfig();
  const auth = useAuthStore();

  async function raw<R>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    opts?: { query?: QueryParams; body?: Record<string, unknown> },
  ): Promise<R> {
    try {
      return await $fetch<R>(path, {
        baseURL: config.public.coreApiBaseUrl,
        method,
        query: opts?.query,
        body: opts?.body,
        headers: auth.token ? { Authorization: `Bearer ${auth.token}` } : {},
      });
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.status === 401 && import.meta.client) {
        auth.logout();
        await navigateTo('/login');
      }
      throw apiError;
    }
  }

  return {
    get<T>(path: string, query?: QueryParams): Promise<T> {
      return raw<ApiEnvelope<T>>('GET', path, { query }).then((r) => r.data);
    },
    post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
      return raw<ApiEnvelope<T>>('POST', path, { body }).then((r) => r.data);
    },
    patch<T>(path: string, body?: Record<string, unknown>): Promise<T> {
      return raw<ApiEnvelope<T>>('PATCH', path, { body }).then((r) => r.data);
    },
    /** register/login carry `meta.token`; device registration carries
     * `meta.device_token` — the two callers that need the full envelope
     * rather than just `data`. */
    postWithMeta<T, M = Record<string, unknown>>(
      path: string,
      body?: Record<string, unknown>,
    ): Promise<ApiEnvelopeWithMeta<T, M>> {
      return raw<ApiEnvelopeWithMeta<T, M>>('POST', path, { body });
    },
  };
}
