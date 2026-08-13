<?php

namespace App\Support;

/**
 * Maps an admin's `admin_role` (admins.admin_role) to the Sanctum token
 * abilities issued at login (App\Http\Controllers\Api\V1\AuthController).
 * A plain static map, not a database-backed roles/permissions system —
 * the role set is small and fixed by the platform, the same "sufficient
 * for MVP-scale authorization" call already made for `users.role` (see
 * the 0001_01_01 users migration's own comment).
 *
 * Abilities are enforced wherever Sanctum abilities normally are —
 * `$request->user()->tokenCan('trips.cancel')` in core-api, or by
 * admin-api reading `personal_access_tokens.abilities` directly for the
 * same token (see docs/decisions/0009-admin-identity.md) — never by
 * trusting a client-supplied role.
 *
 * '*' is Sanctum's own built-in wildcard ability (matches any
 * `tokenCan()` check) — reused for super_admin rather than enumerating
 * every permission twice.
 */
class AdminPermissions
{
    /** @var array<string, array<string>> */
    private const ROLE_ABILITIES = [
        'super_admin' => ['*'],

        'operations_admin' => [
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

        'support_admin' => [
            'dashboard.view',
            'drivers.view',
            'trips.view',
            'rides.view',
            'customers.view',
            'audit.view',
        ],

        'finance_admin' => [
            'dashboard.view',
            'payments.view',
            'payments.refund',
            'audit.view',
        ],

        // Read-only across every domain this platform's admin surface
        // covers — no `.suspend`/`.cancel`/`.refund`/`.manage` ability.
        'viewer' => [
            'dashboard.view',
            'drivers.view',
            'trips.view',
            'rides.view',
            'payments.view',
            'customers.view',
            'audit.view',
        ],
    ];

    /** @return array<string> */
    public static function for(string $adminRole): array
    {
        return self::ROLE_ABILITIES[$adminRole] ?? [];
    }

    /** @return array<string> */
    public static function validRoles(): array
    {
        return array_keys(self::ROLE_ABILITIES);
    }
}
