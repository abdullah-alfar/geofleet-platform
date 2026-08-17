/**
 * Ports apps/core-api/app/Support/AdminPermissions.php's role -> abilities
 * map, byte-for-byte — the map itself is now admin-api's own, since login
 * (and therefore ability issuance) happens here, not in core-api (see
 * docs/decisions/0011-admin-api-independent-service.md). '*' is the same
 * wildcard convention Sanctum tokens used and admin_sessions.abilities
 * still follows, kept for continuity even though Sanctum itself is no
 * longer involved — PermissionsGuard already checks for it explicitly.
 */
const ROLE_ABILITIES: Record<string, string[]> = {
  super_admin: ['*'],

  operations_admin: [
    'dashboard.view',
    'drivers.view',
    'drivers.approve',
    'drivers.suspend',
    'drivers.unsuspend',
    'drivers.disable',
    'trips.view',
    'trips.cancel',
    'rides.view',
    'customers.view',
    'operations.manage',
  ],

  support_admin: [
    'dashboard.view',
    'drivers.view',
    'trips.view',
    'rides.view',
    'customers.view',
    'audit.view',
  ],

  finance_admin: [
    'dashboard.view',
    'payments.view',
    'payments.refund',
    'audit.view',
  ],

  viewer: [
    'dashboard.view',
    'drivers.view',
    'trips.view',
    'rides.view',
    'payments.view',
    'customers.view',
    'audit.view',
  ],
};

export function abilitiesForRole(adminRole: string): string[] {
  return ROLE_ABILITIES[adminRole] ?? [];
}

export function validAdminRoles(): string[] {
  return Object.keys(ROLE_ABILITIES);
}
