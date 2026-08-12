import type { ApiEnvelope, PaginatedResponse } from '~/types/api';
import { toApiError } from '~/utils/apiError';

type QueryParams = Record<string, string | number | boolean | undefined>;

/**
 * The one place every call to admin-api goes through — base URL,
 * bearer-token injection, and error normalization (ApiError) all live
 * here so no page/component builds a raw $fetch call by hand. A `401`
 * always means the token is no longer valid (expired, revoked, or never
 * was) — admin-api never returns 401 for any other reason (see
 * docs/admin-api/authentication.md) — so it's safe to treat globally as
 * "log out and send them to /login" rather than something each caller
 * has to handle individually.
 */
export function useAdminApi() {
  const config = useRuntimeConfig();
  const auth = useAuthStore();

  async function raw<R>(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    opts?: { query?: QueryParams; body?: Record<string, unknown> },
  ): Promise<R> {
    try {
      return await $fetch<R>(path, {
        baseURL: config.public.adminApiBaseUrl,
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
    getPaginated<T>(path: string, query?: QueryParams): Promise<PaginatedResponse<T>> {
      return raw<PaginatedResponse<T>>('GET', path, { query });
    },
    post<T>(path: string, body?: Record<string, unknown>): Promise<T> {
      return raw<ApiEnvelope<T>>('POST', path, { body }).then((r) => r.data);
    },
  };
}
