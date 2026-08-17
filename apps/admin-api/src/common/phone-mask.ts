/**
 * Ports apps/core-api/app/Support/PhoneMask.php exactly — masks
 * everything but the last 4 digits, e.g. "+962791234567" ->
 * "*********4567". Never expose a full phone number to the admin panel.
 */
export function applyPhoneMask(phone: string | null): string | null {
  if (phone === null) {
    return null;
  }

  const visible = phone.slice(-4);
  return '*'.repeat(Math.max(phone.length - 4, 0)) + visible;
}
