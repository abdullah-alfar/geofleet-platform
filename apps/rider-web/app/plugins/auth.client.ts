import type { RiderUser } from '~/types/user';

/**
 * Runs once on app boot, before the first route resolves. Restores the
 * token synchronously, then — if one exists — verifies it against
 * core-api's own GET /api/v1/auth/me before the app mounts, so a
 * revoked/expired token fails closed immediately rather than on the
 * first ride-request call.
 */
export default defineNuxtPlugin(async () => {
  const auth = useAuthStore();
  auth.restoreToken();

  if (!auth.token) {
    return;
  }

  try {
    const api = useCoreApi();
    const user = await api.get<RiderUser>('/api/v1/auth/me');
    auth.setUser(user);
  } catch {
    auth.logout();
  }
});
