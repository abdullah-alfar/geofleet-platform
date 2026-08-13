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
| `operations_admin` | `dashboard.view`, `drivers.view`, `drivers.approve`, `drivers.suspend`, `trips.view`, `trips.cancel`, `rides.view`, `operations.manage` |
| `support_admin` | `dashboard.view`, `drivers.view`, `trips.view`, `rides.view`, `audit.view` |
| `finance_admin` | `dashboard.view`, `payments.view`, `payments.refund`, `audit.view` |
| `viewer` | `dashboard.view`, `drivers.view`, `trips.view`, `rides.view`, `payments.view`, `audit.view` (read-only, no `.suspend`/`.cancel`/`.refund`/`.manage`) |

Source of truth: `apps/core-api/app/Support/AdminPermissions.php`. Not
duplicated in admin-api — the token's `abilities` array, read once at
verification time, is the only copy that matters here.

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
(`src/modules/auth/guards/permissions.guard.spec.ts`), not live HTTP
verification, since there's no real permission-gated endpoint yet (that's
Phase 5/6). `AuthGuard`'s Postgres-dependent identity resolution is what
got the live verification in this phase — see
[authentication.md](authentication.md).

## Adding a new permission

1. Add the ability string to the relevant role(s) in
   `AdminPermissions::ROLE_ABILITIES` (core-api).
2. Existing tokens don't pick it up until re-login (see the trade-off
   note above).
3. Gate the new route with `@RequirePermissions('the.new.permission')`.

No admin-api change needed beyond the route decorator — the permission
set itself lives entirely in core-api.
