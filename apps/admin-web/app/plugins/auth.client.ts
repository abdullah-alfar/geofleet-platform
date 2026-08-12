import type { AdminIdentity } from '~/stores/auth';

/**
 * Runs once on app boot, before the first route resolves. Restores the
 * token synchronously (a plain localStorage read), then — if one exists —
 * verifies it against admin-api's own /session before the app mounts, so
 * `auth.admin.abilities` is already populated for the nav shell's
 * permission-based link filtering (Phase 1's app shell) rather than
 * flashing an incomplete nav and updating a moment later.
 */
export default defineNuxtPlugin(async () => {
  const auth = useAuthStore();
  auth.restoreToken();

  if (!auth.token) {
    return;
  }

  try {
    const api = useAdminApi();
    const session = await api.get<AdminIdentity>('/api/v1/admin/session');
    auth.setAdmin(session);
  } catch {
    // Invalid/expired/revoked token — fail closed. useAdminApi's own 401
    // handling already calls auth.logout(); this covers non-401 failures
    // (e.g. admin-api unreachable at boot) the same way.
    auth.logout();
  }
});
