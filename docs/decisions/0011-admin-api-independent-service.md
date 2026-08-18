# ADR 0011: admin-api becomes an independent service — own auth, direct Postgres/Redis access, no HTTP calls to core-api

## Status
Accepted

## Context

admin-api previously had zero business data of its own: every read
(dashboard/drivers/rides/trips/payments/customers) and every write
(approve/suspend/cancel/refund/role-change/deactivate) was a REST call
to core-api's `internal/v1/*` endpoints, and login was a call to
core-api's shared `POST /api/v1/auth/login` (see [ADR
0009](0009-admin-identity.md)). This was itself the result of an earlier
migration — an even older design where admin-api maintained its own
Kafka-projected `admin_read` schema was torn out in favor of calling
core-api directly (see [docs/admin-api/query-apis.md](../admin-api/query-apis.md)).

The decision this ADR records reverses that REST-to-core-api design
entirely: admin-api now connects directly to the same Postgres database
and Redis instance core-api/dispatch-service already use, with its own
broadened Postgres role, and:

- Has its **own login/session system** — verifies `users.password`
  (bcrypt) itself and mints its own session tokens into `admin_sessions`,
  a table it owns outright. No call to core-api's `/auth/login`, no
  reliance on Sanctum's `personal_access_tokens` at all.
- **Reads** every business entity via direct SQL against core-api's own
  tables.
- **Writes** every admin command directly to those tables, including
  replicating the transactional-outbox insert (so Kafka events keep
  firing for dispatch-service etc.) and the audit-log insert — both
  previously done by core-api's Laravel controllers on admin-api's
  behalf.
- Realtime (Redis) was already a direct read before this change and
  stays that way; the driver-map/incident-feed lookups that used to call
  core-api's REST API for the *business-data* half of that work now call
  `DriversService`/`RidesService`/`TripsService` as regular in-process
  method calls instead.

## Why this is safe against a shared database

Two mechanisms already in this codebase made this change lower-risk than
it might look:

- **The transactional outbox is insert-source-agnostic.** core-api's
  `php artisan outbox:publish` (`PublishOutboxEvents.php`) selects
  `WHERE published_at IS NULL ORDER BY created_at ... FOR UPDATE SKIP
  LOCKED` — it has no opinion about which process inserted a row, only
  that the row exists with the right shape. A row admin-api inserts into
  `outbox_events` gets published by core-api's existing, unmodified
  publish loop. Verified live: an admin-api-issued `driver.status.changed.v1`
  event reached Kafka with `producer: "admin-api"` in its payload,
  through core-api's own publisher, with zero changes to core-api's
  publishing code.
- **Password hashing is portable.** core-api uses bcrypt (`users.password`).
  Bcrypt embeds its cost factor in the hash itself, so Node's
  `bcrypt.compare(plaintext, hash)` verifies a PHP-produced hash
  correctly — with one caveat found live: Laravel/PHP tags its hashes
  `$2y$`, while Node's `bcrypt` package only recognizes `$2a$`/`$2b$`.
  Both are the byte-identical "fixed" bcrypt variant (`$2y$` is PHP's own
  historical name for what's elsewhere called `$2b$`), so
  `AdminAuthService` normalizes the tag before comparing — a standard,
  safe interop step, not a weakened check.

## What was NOT changed

- **Provisioning** stays `php artisan admin:create` only — the one
  legitimate remaining core-api touchpoint, run out-of-band by an
  operator, never called over HTTP by admin-api. [ADR 0009](0009-admin-identity.md)'s
  reasoning for this is unaffected.
- **Schema ownership**: even though admin-api now writes to core-api's
  tables, schema changes to those tables still go through core-api's
  Laravel migrations — the established convention for this shared
  database (the same convention that already let dispatch-service's
  `ride_offers` table and role be added via a core-api migration). The
  new `admin_sessions` table and the broadened `admin_api` Postgres role
  were both added this way.
- **AuthGuard/PermissionsGuard/`@CurrentAdmin`/`AdminPrincipal`**: the
  guard/decorator contract every controller in admin-api already used is
  completely unchanged — only what's inside `TokenVerificationService.verify()`
  changed (which table it queries), so no controller needed to change.

## The new Postgres role

Extends the existing `admin_api` role (previously read-only,
authentication-only — see ADR 0009) with column-scoped grants, following
the same "broad read, narrow write" shape `dispatch_service`'s own role
already established for tables it doesn't fully own
([ADR 0005](0005-geohash-and-dispatch-db-access.md)):

- Full-table `SELECT` on `drivers`/`vehicles`/`driver_devices`/
  `ride_requests`/`ride_offers`/`trips`/`payments`/`customers`/`admins`.
- `SELECT` on `users`, widened past the old `(id, uuid, status, role)` to
  also include `name`/`email`/`phone`/`password`/`region_id` — `password`
  specifically because `AdminAuthService` now verifies it directly at
  login instead of that check happening inside core-api.
- Column-scoped `UPDATE`, one column list per table, matching exactly
  what each ported admin command touches: `drivers(status, is_available)`,
  `trips(status, cancelled_at, cancellation_reason)`, `payments(status)`,
  `admins(admin_role)`, `users(status)`.
- Full CRUD on `admin_sessions` (its own table).
- `INSERT`-only on `outbox_events` and `audit_logs` — admin-api writes
  rows into both but never reads or updates them; core-api's existing
  publish loop is the only reader/updater of `outbox_events`, unchanged.

## Consequences

- **Removed**: `CoreApiClientService`/`CoreApiModule` and every direct
  HTTP call from admin-api to core-api. `pg` was already a dependency
  (used for the old auth-only connection); `bcrypt` is new.
  `@nestjs/axios`/`axios` are no longer used directly (still present
  transitively via `@nestjs/terminus`, harmless).
- **New runtime dependency shape**: admin-api's health/readiness no
  longer checks core-api's reachability at all (there's nothing left
  that depends on it) — `/ready` now checks only Redis and Postgres.
  admin-api now degrades if Postgres or Redis is down, same as before,
  but is fully independent of core-api's own uptime.
- **Trade-off accepted**: two services now write to some of the same
  tables (`drivers`, `trips`, `payments`, `admins`, `users`), each with
  its own implementation of the relevant state-transition guards. Kept
  in sync by porting core-api's exact guard conditions, target columns,
  and audit `action` names 1:1 rather than redesigning them — see the
  worked examples in each of admin-api's `*.service.ts` files
  (`drivers.service.ts` is the fully-annotated reference; the other
  write modules follow the identical shape). Any future change to one of
  these state machines needs to be made in both places.
