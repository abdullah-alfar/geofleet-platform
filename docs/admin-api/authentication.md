# admin-api: Authentication

How a request to admin-api gets from a bearer token to a verified admin
identity — no call back into core-api, ever (now true in an even
stronger sense: admin-api doesn't call core-api for *anything*, not just
auth). See [ADR 0011](../decisions/0011-admin-api-independent-service.md)
(supersedes [ADR 0009](../decisions/0009-admin-identity.md) for this
specific mechanism — the "why Sanctum-style abilities, why an `admins`
table" reasoning in 0009 is still accurate, only the token store
changed).

## Login

```
Admin Web
  -> POST /api/v1/admin/auth/login { email, password }
  -> AdminAuthService.login()
       -> SELECT id, uuid, password, status, role FROM users WHERE email = $1
       -> bcrypt.compare(password, row.password)
            (normalizing core-api's PHP-tagged $2y$ hash to $2b$ first —
            byte-identical algorithm, different tag only)
       -> reject unless: password matches, status = 'active', role = 'admin',
          an admins row exists
       -> generate random plaintext, SHA-256 hash it,
          INSERT INTO admin_sessions (user_id, token_hash, admin_role, abilities, ...)
       -> return "{session_id}|{plaintext}"
```

Every failure path — no such email, wrong password, inactive account,
not an admin — collapses to the same generic `401`, with `bcrypt.compare`
still run even on a not-found email (against a fixed dummy hash) so a
missing-email response doesn't return measurably faster than a
wrong-password one. No account enumeration, same principle core-api's
own login endpoint already applied.

## The chain (every other request)

```
Admin Web
  -> Authorization: Bearer {id}|{plaintext}
  -> AuthGuard (src/modules/auth/guards/auth.guard.ts)
       -> TokenVerificationService.verify()
            -> split "{id}|{plaintext}"
            -> SELECT ... FROM admin_sessions
                 JOIN users ON users.id = admin_sessions.user_id
                 WHERE admin_sessions.id = $1
            -> SHA-256(plaintext), constant-time compare against the
               stored hash (same shape as Sanctum's own
               PersonalAccessToken::findToken(), just admin-api's own
               table now)
            -> reject unless: hash matches, not expired,
               users.status = 'active' (checked live, every call — this
               is what makes admin_account.deactivate take effect on the
               very next request, not just the next login)
       -> request.admin = AdminPrincipal { userId, adminRole, abilities }
  -> route handler, via @CurrentAdmin()
```

Every failure mode — missing header, malformed token, unknown token id,
wrong secret, expired, deactivated account — collapses to the same `401
unauthenticated`. An auth guard should never tell a caller *why* a
credential didn't work (account enumeration risk).

## Postgres access

A dedicated connection pool (`src/integrations/postgres`), connected as
the `admin_api` role. Through Phase 7 this role was auth-only (six
columns across three tables). [ADR 0011](../decisions/0011-admin-api-independent-service.md)
broadened it to full-table `SELECT` on every business table admin-api's
7 modules read, column-scoped `UPDATE` matching exactly what each admin
command writes, and full CRUD on `admin_sessions` — the table this file
describes, which admin-api owns outright and core-api never reads.

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
