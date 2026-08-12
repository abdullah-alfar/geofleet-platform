# ADR 0010: Internal service-to-service authentication — shared secret, not mTLS or a second Sanctum guard

## Status
Accepted

## Context

admin-api's Phase 6 (Laravel command integration) needs core-api to grow
an `internal/v1/*` route group: endpoints that mutate business state
(suspend a driver, cancel a trip, refund a payment) on admin-api's behalf,
per the critical architecture rule in
[docs/admin-api/overview.md](../admin-api/overview.md) — admin-api must
never write to core-api's domain tables directly, only through core-api's
own domain logic.

These endpoints are called by exactly one client (admin-api, from inside
the same Docker network / local host), never by a browser or mobile app.
They need an authentication mechanism that proves "this request came from
admin-api," which is a different problem from Sanctum's "this request
came from a logged-in human" — the human was already authenticated once,
by admin-api's own `AuthGuard`/`PermissionsGuard` (Phase 2), against the
same Sanctum tokens table. Re-authenticating the human a second time at
the core-api boundary would mean core-api trusting a bearer token it
didn't issue for this purpose, or admin-api forwarding the human's own
Sanctum token onward — coupling core-api's internal API to admin-api's
session mechanism for no benefit, since the only thing core-api actually
needs to know from the transport layer is "trust this caller," not
"who is this human" (that identity is instead carried as an explicit
field in the request body — see below).

## Options considered

1. **mTLS** (client-cert auth between admin-api and core-api). Correct at
   production scale, but this platform has no certificate infrastructure
   anywhere else (docker-compose local dev, plain HTTP everywhere) — it
   would be the first PKI dependency in the repo for a two-service, same-
   host call.
2. **A second Sanctum guard / service account token**, i.e. core-api
   issues admin-api a personal-access-token the same way it issues one to
   a human. Reuses existing infrastructure, but conceptually wrong: Sanctum
   tokens are built around a `tokenable` (a `User` row) with `abilities`
   scoped to what that *user* can do — admin-api is not a user, and giving
   it a token tied to a synthetic user row so it can pass `tokenable_type`
   checks would work but exists purely to satisfy a subsystem designed for
   people.
3. **A shared secret in a custom header**, verified with a constant-time
   comparison. The exact pattern this platform already uses three times
   over for its own service-to-service trust — every Go service connects
   to Postgres with a distinct least-privilege role whose password is a
   shared secret between that service's `.env` and core-api's `.env` (see
   `LOCATION_SERVICE_DB_PASSWORD`, `DISPATCH_SERVICE_DB_PASSWORD`,
   `REALTIME_GATEWAY_DB_PASSWORD`, `ADMIN_API_DB_PASSWORD`). This is the
   same shape of problem (one internal caller, one shared credential, no
   need for per-request principal issuance) applied to an HTTP call
   instead of a Postgres connection.

Chose (3).

## Decision

`admin_api_internal_token` — a single shared secret, `ADMIN_API_INTERNAL_TOKEN`
in both `apps/core-api/.env` and `apps/admin-api/.env`, identical value,
same "must match" convention as the DB passwords above. admin-api sends it
as `X-Internal-Service-Token` on every `internal/v1/*` request. core-api's
`App\Http\Middleware\VerifyInternalServiceToken` (alias `internal-service`,
applied to the `internal/v1` route group only — never the public `v1`
group) compares it with `hash_equals()` — the same constant-time-compare
discipline admin-api's own `TokenVerificationService` already applies to
Sanctum token hashes (ADR 0009), for the same reason (a naive `===` string
comparison leaks timing information about how many leading bytes matched).

A single secret, not one per environment/tenant: this is a two-service,
single-environment local platform (no multi-tenant, no staging fleet) —
matching the DB-password precedent rather than over-building credential
rotation this repo doesn't otherwise have anywhere.

## Carrying the human admin's identity across the boundary

The shared secret authenticates *admin-api as a caller*; it says nothing
about *which admin* triggered the command. Once verified, core-api needs
to know who to attribute the action to (for `audit_logs` — see
`App\Domain\Audit\AdminAudit`) and needs some assurance that whoever it is
really is the admin admin-api's own `PermissionsGuard` already authorized
for this exact permission.

Each internal command's request body carries an explicit `admin_user_id`
(the acting admin's `users.uuid` — the same value admin-api's
`AdminPrincipal.userId` already holds, resolved by its own
`TokenVerificationService` against the *same* Postgres `users` table
core-api owns) and an optional `reason`. core-api validates
`admin_user_id` actually exists and belongs to a `role = 'admin'` user
before writing an audit row — cheap defense in depth against a malformed
or stale value, on a boundary that's already authenticated at the
transport level by the shared secret. This is deliberately **not** a
second permission check: `PermissionsGuard` already decided this admin is
allowed to call this command before admin-api ever made the HTTP request;
core-api trusts that decision rather than re-implementing
`AdminPermissions` a second time in PHP for a check that already happened
in TypeScript against the same abilities data.

## Consequences

- `internal/v1/*` routes have no rate limiting beyond Laravel's default
  `throttle:api` (already applied to every `api` route via
  `bootstrap/app.php`'s `throttleApi()`) — acceptable because the caller
  set is exactly one low-volume internal service, not the public internet.
- If `ADMIN_API_INTERNAL_TOKEN` leaks, the blast radius is "can call the 3
  admin commands as if authenticated" — no different in kind from any of
  the other 4 shared-secret credentials this platform already has, and
  mitigated the same way they are (not committed, rotated by changing both
  `.env` files).
- No mutual revocation/expiry: unlike a Sanctum token, this secret doesn't
  expire and isn't tied to a session. Revisit if `internal/v1` ever needs
  more than one caller or a production deployment target — the trigger
  for moving to mTLS or per-caller service-account tokens, not before
  (same "revisit if" discipline as ADR 0009's permissions decision).
