# admin-api: Permissions

Permissions are enforced from the Sanctum token's own `abilities` — set
once at login time by core-api
(`App\Support\AdminPermissions`, see [ADR 0009](../decisions/0009-admin-identity.md)) —
never recomputed or second-guessed by admin-api. If an admin's role
changes, the change takes effect on their *next* login (new token, new
abilities), not retroactively on tokens already issued. That's a
deliberate simplicity trade-off, same one Sanctum abilities always have —
revisit only if "revoke a permission immediately, mid-session" becomes a
real requirement (the fix would be revoking the token itself via
core-api, which already works today, not a change to this scheme).

## Roles -> abilities (defined once, in core-api)

| `admin_role` | Abilities |
|---|---|
| `super_admin` | `*` (Sanctum's own wildcard) |
| `operations_admin` | `dashboard.view`, `drivers.view`, `drivers.approve`, `drivers.suspend`, `drivers.unsuspend`, `drivers.disable`, `trips.view`, `trips.cancel`, `rides.view`, `customers.view`, `operations.manage` |
| `support_admin` | `dashboard.view`, `drivers.view`, `trips.view`, `rides.view`, `customers.view`, `audit.view` |
| `finance_admin` | `dashboard.view`, `payments.view`, `payments.refund`, `audit.view` |
| `viewer` | `dashboard.view`, `drivers.view`, `trips.view`, `rides.view`, `payments.view`, `customers.view`, `audit.view` (read-only, no `.suspend`/`.cancel`/`.refund`/`.manage`) |

Source of truth: `apps/core-api/app/Support/AdminPermissions.php`. Not
duplicated in admin-api — the token's `abilities` array, read once at
verification time, is the only copy that matters here.

Two permissions — `admins.view`, `admins.manage` (admin account
management: list/change-role/deactivate other admins,
[laravel-integration.md](laravel-integration.md)) — deliberately don't
appear in *any* role's array above, `super_admin` included. Only
`super_admin`'s own `'*'` wildcard satisfies them; there was no reason to
also spell them out explicitly on that row when `'*'` already covers
everything by definition. Managing who else can operate the admin panel
is the platform's highest-privilege concern, so this is the one place in
the permission model deliberately has no path through an enumerated
ability string — only the wildcard.

## Requiring a permission on a route

```ts
@Controller('trips')
@UseGuards(AuthGuard, PermissionsGuard)
export class TripsController {
  @Post(':id/cancel')
  @RequirePermissions('trips.cancel')
  cancel(@CurrentAdmin() admin: AdminPrincipal, @Param('id') id: string) {
    // ...
  }
}
```

`AuthGuard` must run before `PermissionsGuard` — it's what populates
`request.admin`. Order in `@UseGuards(...)` is the execution order.

A route with no `@RequirePermissions()` at all is allowed for any
authenticated admin, same as `GET /api/v1/admin/session` — the decorator
is opt-in per route, not a default-deny.

## How the check works (`PermissionsGuard`)

1. Read the route's required permissions via `Reflector` (empty/missing
   metadata -> allow).
2. `'*'` in the principal's abilities -> allow.
3. Otherwise every required permission must be present — missing any of
   them -> `403 Forbidden` listing which ones.

Pure function, no I/O — covered by Jest unit tests
(`src/modules/auth/guards/permissions.guard.spec.ts`) *and*, from Phase 5
onward, real HTTP traffic against real permission-gated endpoints —
every later phase's own docs record a token getting exactly the
`200`/`403` its abilities predict (see
[query-apis.md](query-apis.md), [laravel-integration.md](laravel-integration.md),
[realtime-operations.md](realtime-operations.md)).

## Adding a new permission

1. Add the ability string to the relevant role(s) in
   `AdminPermissions::ROLE_ABILITIES` (core-api).
2. Existing tokens don't pick it up until re-login (see the trade-off
   note above).
3. Gate the new route with `@RequirePermissions('the.new.permission')`.

No admin-api change needed beyond the route decorator — the permission
set itself lives entirely in core-api.
