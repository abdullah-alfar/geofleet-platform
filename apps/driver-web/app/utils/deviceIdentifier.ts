const IDENTIFIER_KEY = 'driver-web:device-identifier';

/** A stable per-browser identifier, generated once and reused across
 * registration attempts — device_identifier has a uniqueness constraint
 * server-side (see StoreDriverDeviceRequest), so a fresh UUID on every
 * retry would collide with an already-registered-but-not-yet-saved
 * attempt instead of just resubmitting the same one. */
export function stableDeviceIdentifier(): string {
  let id = localStorage.getItem(IDENTIFIER_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(IDENTIFIER_KEY, id);
  }
  return id;
}
