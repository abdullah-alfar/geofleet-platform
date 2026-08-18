/**
 * Runs once on app boot. Restores both credentials — the Sanctum user
 * token and the separate device token (see stores/device.ts) — then
 * verifies the user token against core-api's own GET /api/v1/auth/me
 * before the app mounts, so a revoked/expired token fails closed
 * immediately rather than on the first command.
 */
export default defineNuxtPlugin(async () => {
  const auth = useAuthStore();
  const device = useDeviceStore();
  auth.restoreToken();
  device.restore();

  if (!auth.token) {
    return;
  }

  try {
    await auth.refresh();
  } catch {
    auth.logout();
  }
});
