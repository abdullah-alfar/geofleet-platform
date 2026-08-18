import { toApiError } from '~/utils/apiError';

/** Calls dispatch-service or location-service, both authenticated with
 * the device token (never the Sanctum user token — see stores/device.ts).
 * Unlike useCoreApi, these two services don't wrap responses in
 * `{ data: ... }` uniformly (offer accept/reject return a flat object;
 * ListPending wraps in `{ data: [...] }`) — callers unwrap themselves. */
export function useDeviceApi() {
  const device = useDeviceStore();

  async function call<R>(
    baseURL: string,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<R> {
    if (!device.deviceToken) {
      throw new Error('No device registered yet.');
    }
    try {
      return await $fetch<R>(path, {
        baseURL,
        method,
        body,
        headers: { Authorization: `Bearer ${device.deviceToken}` },
      });
    } catch (error) {
      throw toApiError(error);
    }
  }

  return { call };
}
