import { toApiError, ApiError } from '~/utils/apiError';

type QueryValue = string | number | boolean | undefined;

/**
 * Wraps one of admin-api's cursor-paginated list endpoints (Phase 5 —
 * keyset pagination, never OFFSET). `query` is a reactive ref the caller
 * owns and mutates directly (filter form inputs bind to it); changing it
 * and calling `refresh()` starts a fresh first page — `loadMore()` keeps
 * appending using the server's own `next_cursor`, never a client-computed
 * offset.
 */
export function usePaginatedList<T>(path: string, initialQuery: Record<string, QueryValue> = {}) {
  const api = useAdminApi();

  const query = reactive<Record<string, QueryValue>>({ ...initialQuery });
  const items = ref<T[]>([]) as Ref<T[]>;
  const nextCursor = ref<string | null>(null);
  const pending = ref(false);
  const error = ref<ApiError | null>(null);

  async function load(reset: boolean) {
    pending.value = true;
    error.value = null;
    try {
      const cursor = reset ? undefined : (nextCursor.value ?? undefined);
      const response = await api.getPaginated<T>(path, { ...query, cursor });
      items.value = reset ? response.data : [...items.value, ...response.data];
      nextCursor.value = response.meta.next_cursor;
    } catch (e) {
      error.value = e instanceof ApiError ? e : toApiError(e);
    } finally {
      pending.value = false;
    }
  }

  function refresh() {
    return load(true);
  }

  function loadMore() {
    if (nextCursor.value && !pending.value) {
      return load(false);
    }
  }

  return {
    query,
    items,
    nextCursor: computed(() => nextCursor.value),
    pending: computed(() => pending.value),
    error: computed(() => error.value),
    refresh,
    loadMore,
  };
}
