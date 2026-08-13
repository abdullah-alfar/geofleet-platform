# admin-api: Overview

`apps/admin-api` is a NestJS 11/TypeScript Admin BFF for the GeoFleet
platform: it serves the administrative dashboard by reading live from
core-api's own `internal/v1` API and forwards operational commands to it,
rather than mutating (or maintaining its own copy of) Laravel-owned
tables. Full audit of what existed before this service was built
(repository state, Laravel routes/auth, Kafka topics, Docker,
Postgres/Redis) is preserved in the Phase 0 conversation; this doc and
[architecture.md](architecture.md) capture the durable decisions that came
out of it.

Phases 3–5 below built this the other way — a Kafka-projected read model,
`admin_read`, admin-api's own schema — which was retired afterward in
favor of reading core-api directly; see architecture.md's
["Kafka projections retired"](architecture.md#kafka-projections-retired---reads-go-straight-to-core-api)
section for why. The phase history below is left as an honest record of
what was actually built and verified at each step, including the parts
later replaced.

## Why this exists, and why it's separate from the 8-phase plan

The repo root [AGENTS.md](../../AGENTS.md) phase map (0-8) describes the
core ride-hailing/fleet-tracking platform: core-api, three Go services,
Kafka, Postgres/PostGIS, Redis — all complete as of Phase 8. admin-api is
genuinely new, additive scope on top of that finished platform, not a
continuation of the original plan — it gets its own phase numbering below
rather than pretending to be "Phase 9" of a plan that was explicitly
closed out.

## Critical architecture rule

**core-api (Laravel) owns core business operations and durable domain
logic. admin-api must never perform a business-state mutation by directly
modifying core-api's Postgres tables — and, since the Kafka-projection
retirement, must never read one directly either.**

```
Commands:  Admin Web -> admin-api -> core-api internal/v1 (PATCH) -> domain logic -> Postgres -> outbox -> Kafka
Queries:   Admin Web -> admin-api -> core-api internal/v1 (GET)   -> Postgres -> admin-api -> Admin Web
```

See [architecture.md](architecture.md) for why, and for the query/command
separation in full.

## Phase plan

Numbered independently from the root AGENTS.md phases; "Phase 1" here
means admin-api's own Phase 1, not the platform's.

0. **Repository & architecture audit** — done, read-only, no files changed.
1. **NestJS foundation** — done. Config validation, structured logging,
   correlation-id propagation, response/error envelope, health/readiness,
   Prometheus metrics, Swagger, Docker. No business modules, no
   authentication, no database, no Kafka consumers yet.
2. **Authentication and permissions** — done. `admin_api` Postgres role
   (auth-only — personal_access_tokens/users/admins, no domain tables),
   `TokenVerificationService` (Sanctum-token verification against
   Postgres, no call back into core-api), `AuthGuard` + `@CurrentAdmin()`,
   `PermissionsGuard` + `@RequirePermissions()`, a log-only audit
   foundation (`AuditService` — durable storage deferred, see Phase 3
   note below), and `GET /api/v1/admin/session` proving the whole chain
   live. See [authentication.md](authentication.md) and
   [permissions.md](permissions.md).
3. **Admin read database** — done at the time, later retired. `admin_api`
   (same role as Phase 2, not a second one) owned an `admin_read` schema
   outright. Kysely migrations, the inbox table, and five projection
   tables (driver/ride/ride-offer/trip/payment) + regional metrics — all
   empty until Phase 4 populated them, two of them (trip/payment) staying
   empty even after that until core-api's own producer-side gaps closed.
   The whole schema no longer exists — see architecture.md's "Kafka
   projections retired" section. No `admin_action_logs` table — that
   wasn't in this phase's actual scope (only the 5 tables + inbox the
   original plan named); `AuditService` stays log-only, the durable
   record is core-api's own `audit_logs` (Phase 6).
4. **Kafka projection consumers** — done at the time, later retired. One
   consumer (group `admin-api`), 9 live topics, `fromBeginning: true`
   (backfills from Kafka's 7-day retention on first run). Idempotent
   per-handler inbox pattern, one handler per event_type.
   `admin_trip_projection`/`admin_payment_projection` never got a
   consumer — their topics stayed producer-less the whole time this
   architecture existed. This consumer, every handler, and the schema it
   fed are all deleted now — see architecture.md's "Kafka projections
   retired" section for the replacement. At the time, this phase was
   live-verified against real historical replay (106/256/189 rows on
   first connect) and fresh traffic from `scripts/loadtest`, with exact
   row-count deltas and a restart-idempotency check.
5. **Admin query APIs** — done, later re-pointed at core-api directly
   (see item 4). 11 endpoints across dashboard, drivers, rides (+offers),
   trips, payments — all cursor-paginated, all gated by
   `AuthGuard`+`PermissionsGuard` with real per-domain `*.view`
   permissions. No `/drivers/:id/timeline` or `/trips/:id/timeline` (no
   data source — see [query-apis.md](query-apis.md)); ride/trip
   milestones embedded in their detail responses instead. Dashboard read
   live aggregates from the projection tables at the time; now reads the
   same live aggregates directly from core-api's own tables instead (no
   `admin_region_metrics` anymore either way — that table was never
   populated). Live-verified with real permission enforcement
   (a `finance_admin` token correctly got 403 on `/drivers`, 200 on
   `/payments`) and exact-match freshness-window counts against fresh
   `scripts/loadtest` traffic.
6. **Laravel command integration** — done. core-api grew `internal/v1/*`
   (shared-secret auth — [ADR 0010](../decisions/0010-internal-service-authentication.md)),
   three commands (`drivers.suspend`, `trips.cancel`, `payments.refund`),
   each a conditional atomic Postgres update plus a first-ever write to
   the previously-unused `audit_logs` table. admin-api forwards to it via
   `CoreApiClientService`, gated by the same real per-domain permissions
   Phase 5's queries use. `driver.status.changed.v1` is reused for
   suspend (so dispatch-service's existing consumer drops a suspended
   driver from matching immediately); `trip.cancelled.v1` — reserved
   since Phase 1 but never produced — got its first live producer.
   `payments.refund` deliberately publishes nothing (no
   `payment.refunded.v1` topic exists — see
   [laravel-integration.md](laravel-integration.md)). Live-verified
   end-to-end: real Postgres writes, a real Kafka message consumed
   straight off `trip.cancelled.v1`, real audit rows, and real permission
   enforcement (`operations_admin` succeeding on suspend/cancel and
   getting `403` on refund; the reverse for `finance_admin`) — see
   [laravel-integration.md](laravel-integration.md) for the full chain,
   the idempotency/conflict semantics, and a real bug it caught
   (`AuditLog` had no `#[Fillable]`, so nothing had ever written to
   `audit_logs` before this phase).
7. **Realtime operations** — done. The only admin-api module that reads
   Redis for anything beyond a health ping: a region-scoped, throttled
   live driver map and live driver counters
   (`GET /realtime/regions/:regionId/{drivers,counters}`), both sourced
   from dispatch-service's own `dispatch:driver:{id}` Redis keys — never
   `dispatch:geocell:*`, admin-api doesn't re-implement geohash search — 
   plus a computed incident feed (`GET /realtime/incidents`: stale
   `searching` rides, drivers gone silent mid-trip) built entirely from
   data this platform already has, no new domain model. Live-verified
   against real `scripts/loadtest` traffic (6/6 drivers matched exactly
   between the map and the counters) and, notably, against **86 real**
   stale-searching-ride incidents already sitting in this platform's data
   from earlier load-testing phases — a real, previously-invisible
   operational gap this endpoint surfaced without any fabricated test
   data. See [realtime-operations.md](realtime-operations.md) for the
   freshness bug it caught (a deleted driver's orphaned Redis key would
   have rendered a phantom pin at 0,0) and the incident-cap bug it caught
   (an unbounded query would have returned all 86+ rows).

## Known gap from Phase 0 — resolved

core-api had no admin identity model as of Phase 0: `users.role` allowed
`admin` at the database level, but no route, controller, middleware, or
permissions table used it. This is now resolved — see
[ADR 0009](../decisions/0009-admin-identity.md): an `admins` profile table
(mirroring `customers`/`drivers`), a static `admin_role` -> Sanctum token
abilities map (`App\Support\AdminPermissions`), admin-scoped tokens issued
by the existing `/api/v1/auth/login` endpoint, and out-of-band provisioning
via `php artisan admin:create`. admin-api's own Phase 2 (verifying these
tokens, the actual `PermissionsGuard`) is unblocked and can now proceed.

## See also

- [architecture.md](architecture.md) — container-level view, query/command
  separation, tech choices and why.
- [authentication.md](authentication.md) / [permissions.md](permissions.md) —
  Phase 2's auth chain and permission model.
- [query-apis.md](query-apis.md) — every read endpoint as it exists today
  (post-retirement): what each one does, cursor pagination, and the scope
  decisions behind them. Phase 3's `admin_read` schema and Phase 4's
  Kafka consumer, both described in earlier revisions of this doc set,
  no longer exist — see architecture.md's "Kafka projections retired"
  section for what replaced them and why.
- [laravel-integration.md](laravel-integration.md) — Phase 6's command
  chain, error propagation, idempotency semantics, and which Kafka events
  do (and don't) fire.
- [realtime-operations.md](realtime-operations.md) — Phase 7's Redis
  usage, the freshness/incident-cap bugs live testing caught, and what
  could and couldn't be verified organically.
- [../architecture/container-diagram.md](../architecture/container-diagram.md) —
  the platform-wide container diagram; admin-api still isn't on it. Now
  that Phase 5 has real query traffic (the condition that note was
  waiting on), updating that diagram to include admin-api is a
  reasonable next documentation task — not done as part of this phase to
  avoid scope creep into a doc outside `docs/admin-api/`.
