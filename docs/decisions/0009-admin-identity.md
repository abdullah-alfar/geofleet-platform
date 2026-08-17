# ADR 0009: Admin identity — Sanctum token abilities, not a separate identity system

## Status
Accepted. **Superseded in part by [ADR 0011](0011-admin-api-independent-service.md)**:
the "What this enables for admin-api" section below (verifying tokens
directly against core-api's Postgres tables, "no call back into
core-api") describes admin-api's *old* auth mechanism — admin-api now
has its own independent login/session system and no longer reads
`personal_access_tokens` at all. Everything above that section (reusing
Sanctum for customer/driver/admin identity, the `admins` table shape,
`AdminPermissions`' static role map, out-of-band provisioning) is still
accurate and unaffected.

## Context

`apps/admin-api`'s Phase 2 (authentication and permissions) needs a way
to know, for a given bearer token, whether its holder is an admin and
which permissions they have — `dashboard.view`, `trips.cancel`,
`payments.refund`, etc. Before this decision, core-api had no admin
identity model at all: `users.role` allowed the literal value `'admin'`
at the database level, but no route, controller, middleware, or
permissions table used it, and `RegisterRequest` explicitly refused to
accept `role: admin` (self-registration as an admin would defeat the
point of the role — see that class's own comment).

Two shapes were available for the missing piece:

1. A parallel identity system inside admin-api — its own users table,
   its own password hashing, its own token issuance (JWT or otherwise).
2. Extend core-api's existing Sanctum-based identity: an `admins` profile
   table (mirroring `customers`/`drivers`), and issue Sanctum tokens with
   **abilities** scoped to the admin's role.

Chose (2).

## Why not a separate identity system

This platform has reused one identity source for every consumer so far —
customers/drivers authenticate with core-api's Sanctum tokens, and
location-service, dispatch-service, and realtime-gateway all verify
credentials against core-api's Postgres tables directly rather than
inventing their own (see
[ADR 0006](0006-realtime-gateway-fanout.md)'s "reusing existing auth, not
inventing a third mechanism"). A second identity system for admins would
mean two password policies, two account-recovery flows, and two answers
to "is this account active" — for a use case (staff accounts) that's
strictly narrower than what Sanctum already handles. There's no
requirement here Sanctum doesn't already meet.

## Why Sanctum abilities, not a roles/permissions database

Sanctum's `personal_access_tokens` table already has an `abilities`
column — a JSON array stored per token, checked via `tokenCan()`. This is
built for exactly this shape of problem and was already present (unused)
since the Phase 2 Sanctum migration. Two options within core-api for
mapping an admin's role to a permission set:

- A `roles`/`permissions`/`role_permissions` database schema (a full RBAC
  package).
- A static, in-code map from `admin_role` to an array of ability strings.

Chose the static map (`App\Support\AdminPermissions`) — the role set
(`super_admin`, `operations_admin`, `support_admin`, `finance_admin`,
`viewer`) is small, fixed by the platform (not tenant-configurable), and
changes to it are code changes anyway (a new permission means new code
somewhere that checks it). A database-backed RBAC system would add
migration/seeding overhead for a set of five roles that doesn't need
runtime reconfiguration — the same "sufficient for MVP-scale
authorization, not a full RBAC package" reasoning already applied to
`users.role` itself (see the `0001_01_01_000000_create_users_table`
migration's own comment). `super_admin` reuses Sanctum's own built-in `*`
wildcard ability rather than enumerating every permission twice.

**Revisit if**: permissions need to be admin-configurable at runtime
(e.g. a support admin's exact permission set needs to differ per admin,
not per role) — that's the trigger for a real roles/permissions table,
not before.

## Schema: `admins`, not a column on `users`

An `admins` table (`user_id` FK, `admin_role`, `CHECK` constraint) mirrors
the existing `customers`/`drivers` shape exactly — `User::admin(): HasOne`
alongside the existing `customer()`/`driver()` relations — rather than
adding an `admin_role` column directly to `users` (which would be null
for the other 99% of rows, `customers`/`drivers`-style profile tables are
the pattern this schema already uses for role-specific data).

## Provisioning: out-of-band only

`RegisterRequest` already refused `role: admin` before this ADR — that
constraint doesn't change. The only way to create an admin account is
`php artisan admin:create {email} {name} {admin_role}`
(`App\Console\Commands\CreateAdmin`), an operator-run command, not an
HTTP endpoint. Generates a random password and prints it once (never
logged, never stored in plaintext) if `--password` isn't supplied.

## What this enables for admin-api (Phase 2, not built by this ADR)

admin-api can verify an admin token the same way realtime-gateway already
verifies customer/driver Sanctum tokens ([ADR
0006](0006-realtime-gateway-fanout.md)) — split `"{id}|{plaintext}"`,
hash, look up `personal_access_tokens`, join `users`/`admins` — and read
`abilities` directly off the token row for permission checks, with no
call back into core-api and no second token-verification implementation
to keep in sync. That work (a new least-privilege Postgres role for
admin-api, the actual `PermissionsGuard`) is Phase 2 of
[docs/admin-api/overview.md](../admin-api/overview.md), not part of this
change.
