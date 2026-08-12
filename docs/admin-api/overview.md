# admin-api: Overview

`apps/admin-api` is a NestJS 11/TypeScript Admin BFF for the GeoFleet
platform: it serves the administrative dashboard by aggregating read
models built from Kafka events, and forwards operational commands to
core-api rather than mutating Laravel-owned tables itself. Full audit of
what existed before this service was built (repository state, Laravel
routes/auth, Kafka topics, Docker, Postgres/Redis) is preserved in the
Phase 0 conversation; this doc and
[architecture.md](architecture.md) capture the durable decisions that came
out of it.

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
modifying core-api's Postgres tables.**

```
Commands:  Admin Web -> admin-api -> core-api internal API -> domain logic -> Postgres -> outbox -> Kafka
Queries:   Kafka -> admin-api projection consumers -> admin_read schema -> admin-api -> Admin Web
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
3. **Admin read database** — done. `admin_api` (same role as Phase 2, not
   a second one) now owns the `admin_read` schema outright. Kysely
   migrations, the inbox table, and five projection tables
   (driver/ride/ride-offer/trip/payment) + regional metrics — all empty
   until Phase 4 populates them, two of them (trip/payment) staying empty
   even after that until core-api's own producer-side gaps close (see
   [read-models.md](read-models.md)). No `admin_action_logs` table —
   that wasn't in this phase's actual scope (only the 5 tables + inbox
   the original plan named); `AuditService` stays log-only until a real
   need for durable audit history shows up.
4. **Kafka projection consumers** — done. One consumer (group
   `admin-api`), 9 live topics, `fromBeginning: true` (backfills from
   Kafka's 7-day retention on first run). Idempotent per-handler inbox
   pattern, one handler per event_type. `admin_trip_projection`/
   `admin_payment_projection` still have no consumer — their topics are
   still producer-less (see [kafka-projections.md](kafka-projections.md)).
   Live-verified against real historical replay (106/256/189 rows on
   first connect) and fresh traffic from `scripts/loadtest`, with exact
   row-count deltas and a restart-idempotency check.
5. **Admin query APIs** — done. 11 endpoints across dashboard, drivers,
   rides (+offers), trips, payments — all cursor-paginated, all gated by
   `AuthGuard`+`PermissionsGuard` with real per-domain `*.view`
   permissions. No `/drivers/:id/timeline` or `/trips/:id/timeline` (no
   data source — see [query-apis.md](query-apis.md)); ride/trip
   milestones embedded in their detail responses instead. Dashboard reads
   live aggregates from the projection tables, not the still-unpopulated
   `admin_region_metrics`. Live-verified with real permission enforcement
   (a `finance_admin` token correctly got 403 on `/drivers`, 200 on
   `/payments`) and exact-match freshness-window counts against fresh
   `scripts/loadtest` traffic.
6. **Laravel command integration** — not started. Requires core-api to
   grow an `internal/v1/*` route group and a service-to-service auth
   mechanism that don't exist today — see
   [laravel-integration.md](laravel-integration.md) (written once this
   phase starts) for the exact contract this service needs from core-api.
7. **Realtime operations** — not started. Live dashboard counters, a
   throttled/region-scoped driver map, incident updates.

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
- [read-models.md](read-models.md) — Phase 3's `admin_read` schema, tables,
  and indexes.
- [kafka-projections.md](kafka-projections.md) — Phase 4's consumer
  pipeline, idempotency, and what live verification found.
- [query-apis.md](query-apis.md) — Phase 5's endpoints, cursor
  pagination, and the two scope decisions behind them.
- [../architecture/container-diagram.md](../architecture/container-diagram.md) —
  the platform-wide container diagram; admin-api still isn't on it. Now
  that Phase 5 has real query traffic (the condition that note was
  waiting on), updating that diagram to include admin-api is a
  reasonable next documentation task — not done as part of this phase to
  avoid scope creep into a doc outside `docs/admin-api/`.
