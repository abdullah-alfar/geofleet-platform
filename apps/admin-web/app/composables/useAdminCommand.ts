import { toApiError, ApiError } from '~/utils/apiError';

/**
 * Wraps a POST to one of admin-api's command endpoints (suspend/cancel/
 * refund/approve/etc.) — all take an optional `reason` and return the
 * mutated resource. Kept generic rather than repeating near-identical
 * copies: same request shape, same pending/error handling, same
 * "refresh the detail view after a successful command" pattern.
 */
export function useAdminCommand() {
  const api = useAdminApi();
  const pending = ref(false);
  const error = ref<ApiError | null>(null);

  async function runWithBody<T>(
    path: string,
    body: Record<string, unknown>,
  ): Promise<T | null> {
    pending.value = true;
    error.value = null;
    try {
      return await api.post<T>(path, body);
    } catch (e) {
      error.value = e instanceof ApiError ? e : toApiError(e);
      return null;
    } finally {
      pending.value = false;
    }
  }

  /** The common case: a command that only ever takes `{ reason }`. */
  function run<T>(path: string, reason?: string): Promise<T | null> {
    return runWithBody<T>(path, reason ? { reason } : {});
  }

  return {
    pending: computed(() => pending.value),
    error: computed(() => error.value),
    run,
    runWithBody,
  };
}
