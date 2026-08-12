# admin-api: Authentication

How a request to admin-api gets from a bearer token to a verified admin
identity — no call back into core-api, ever. See
[ADR 0009](../decisions/0009-admin-identity.md) for why this shape was
chosen.

## The chain

```
Admin Web
  -> Authorization: Bearer {id}|{plaintext}
  -> AuthGuard (src/modules/auth/guards/auth.guard.ts)
       -> TokenVerificationService.verify()
            -> split "{id}|{plaintext}"
            -> SELECT ... FROM personal_access_tokens
                 JOIN users ON users.id = personal_access_tokens.tokenable_id
                 LEFT JOIN admins ON admins.user_id = users.id
                 WHERE personal_access_tokens.id = $1
            -> SHA-256(plaintext), constant-time compare against the
               stored hash (same algorithm as Sanctum's own
               PersonalAccessToken::findToken())
            -> reject unless: hash matches, not expired,
               users.status = 'active', users.role = 'admin',
               an admins row exists
       -> request.admin = AdminPrincipal { userId, adminRole, abilities }
  -> route handler, via @CurrentAdmin()
```

Every failure mode — missing header, malformed token, unknown token id,
wrong secret, expired, wrong role, suspended account, missing admin
profile — collapses to the same `401 unauthenticated`. An auth guard
should never tell a caller *why* a credential didn't work (account
enumeration risk), the same principle core-api's own login endpoint
already applies.

## Postgres access

A dedicated connection pool (`src/integrations/postgres`), connected as
the `admin_api` role
(`apps/core-api/database/migrations/2026_08_12_110000_create_admin_api_role.php`).
That role can `SELECT` exactly six columns across three tables —
`personal_access_tokens (id, tokenable_id, tokenable_type, token,
abilities, expires_at)`, `users (id, uuid, status, role)`, `admins
(user_id, admin_role)` — and nothing else. No ride/trip/payment/driver
domain table is reachable through this connection. This is intentionally
narrower than every Go service's own Postgres role in this platform: it
answers exactly one question (is this bearer token a live admin session,
and what can it do), never business data.

## Using it in a controller

```ts
@Controller('some-resource')
@UseGuards(AuthGuard)
export class SomeController {
  @Get()
  list(@CurrentAdmin() admin: AdminPrincipal) {
    // admin.userId, admin.adminRole, admin.abilities
  }
}
```

See [permissions.md](permissions.md) for adding a permission requirement
on top of `AuthGuard` with `@RequirePermissions()` + `PermissionsGuard`.

## What's proven live vs. unit-tested

`GET /api/v1/admin/session` (`src/modules/auth/session.controller.ts`)
exercises the entire chain above against real Postgres — verified with
real admin tokens (`super_admin`, `viewer`), a real but non-admin
customer token (correctly rejected — proves this isn't just "is the token
valid," it's "is this specifically an admin"), and malformed/unknown/
wrong-secret tokens. `PermissionsGuard`'s permission-matching logic
(pure, no I/O) is covered by Jest unit tests
(`src/modules/auth/guards/permissions.guard.spec.ts`) *and*, as of Phase 5
onward, real HTTP traffic against real permission-gated endpoints — every
later phase's own docs record a `finance_admin`/`operations_admin`/
`viewer` token getting exactly the `200`/`403` its abilities predict
(see [query-apis.md](query-apis.md), [laravel-integration.md](laravel-integration.md),
[realtime-operations.md](realtime-operations.md)) — not just the unit
tests in isolation.

## A real bug this live verification caught

Testing `PostgresHealthIndicator`'s failure path (stopping Postgres via
Docker) crashed the entire admin-api process, not just `/ready` — a
`pg.Pool` emits an `'error'` event when an *idle* pooled connection drops
in the background, and Node treats an unlistened `'error'` event as fatal.
Fixed in `src/integrations/postgres/postgres.module.ts` by attaching
`pool.on('error', ...)` — the same class of fix already applied to the
Redis client in Phase 1
(`src/health/indicators/redis.indicator.ts`), missed here until an actual
outage test surfaced it. Re-verified afterward: stopping Postgres now
correctly yields `503`/`500` responses with the process staying alive
throughout, and a clean recovery once Postgres comes back.
