import type { ApiEnvelope, ApiEnvelopeWithMeta } from '~/types/api';
import { toApiError } from '~/utils/apiError';

type QueryParams = Record<string, string | number | boolean | undefined>;

/**
 * The one place every call to core-api goes through, mirroring
 * admin-web's own useAdminApi — bearer-token injection and error
 * normalization (ApiError) live here so no page builds a raw $fetch call
 * by hand. A `401` always means the token is no longer valid, so it's
 * safe to treat globally as "log out and send them to /login".
 */
export function useCoreApi() {
  const config = useRuntimeConfig();
  const auth = useAuthStore();

  async function raw<R>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    opts?: { query?: QueryParams; body?: Record<string, unknown>; headers?: Record<string, string> },
  ): Promise<R> {
    try {
      return await $fetch<R>(path, {
        baseURL: config.public.coreApiBaseUrl,
        method,
        query: opts?.query,
        body: opts?.body,
        headers: {
          ...(auth.token ? { Authorization: `Bearer ${auth.token}` } : {}),
          ...opts?.headers,
        },
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
    post<T>(path: string, body?: Record<string, unknown>, headers?: Record<string, string>): Promise<T> {
      return raw<ApiEnvelope<T>>('POST', path, { body, headers }).then((r) => r.data);
    },
    /** login/register additionally carry a `meta.token` alongside `data`
     * — the one core-api response shape this app needs the full envelope
     * for, rather than just the unwrapped `data`. */
    postWithMeta<T, M = Record<string, unknown>>(
      path: string,
      body?: Record<string, unknown>,
    ): Promise<ApiEnvelopeWithMeta<T, M>> {
      return raw<ApiEnvelopeWithMeta<T, M>>('POST', path, { body });
    },
  };
}
