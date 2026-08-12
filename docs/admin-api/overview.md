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
   foundation (`AuditService` — durable storage is Phase 3), and
   `GET /api/v1/admin/session` proving the whole chain live. See
   [authentication.md](authentication.md) and
   [permissions.md](permissions.md).
3. **Admin read database** — not started. The `admin_api` role already
   exists (Phase 2, auth-only) but has no schema beyond the three
   authentication tables it can read — this phase adds the `admin_read`
   schema, migrations, the inbox table, and the projection tables
   themselves (empty until Phase 4 populates them). Likely needs its own,
   broader Postgres role/grants (`CREATE`/`INSERT`/`UPDATE` on
   `admin_read.*`) distinct from the read-only auth role.
4. **Kafka projection consumers** — not started. Idempotent handlers for
   the live topics in [kafka-projections.md](kafka-projections.md)
   (written once this phase starts).
5. **Admin query APIs** — not started. Dashboard, drivers, rides, trips,
   payments, with cursor pagination.
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
- [../architecture/container-diagram.md](../architecture/container-diagram.md) —
  the platform-wide container diagram; admin-api isn't on it yet since it
  wasn't part of the 8-phase plan that diagram describes — revisit once
  admin-api reaches Phase 5 (real query traffic).
