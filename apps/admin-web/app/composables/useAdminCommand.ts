import { toApiError, ApiError } from '~/utils/apiError';

/**
 * Wraps a POST to one of admin-api's Phase 6 command endpoints
 * (suspend/cancel/refund) — all take an optional `reason` and return the
 * mutated resource. Kept generic rather than three near-identical
 * copies: same request shape, same pending/error handling, same
 * "refresh the detail view after a successful command" pattern.
 */
export function useAdminCommand() {
  const api = useAdminApi();
  const pending = ref(false);
  const error = ref<ApiError | null>(null);

  async function run<T>(path: string, reason?: string): Promise<T | null> {
    pending.value = true;
    error.value = null;
    try {
      return await api.post<T>(path, reason ? { reason } : {});
    } catch (e) {
      error.value = e instanceof ApiError ? e : toApiError(e);
      return null;
    } finally {
      pending.value = false;
    }
  }

  return {
    pending: computed(() => pending.value),
    error: computed(() => error.value),
    run,
  };
}
