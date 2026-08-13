# admin-api

NestJS 11 / TypeScript. The Admin BFF for the GeoFleet platform — serves
the administrative dashboard by reading live from and forwarding
operational commands to core-api's internal API. Does not own core
business domain data or mutate (or read) Laravel-owned tables directly —
every query and command goes through core-api's own `internal/v1` API.
See [docs/admin-api/overview.md](../../docs/admin-api/overview.md) and
[docs/admin-api/architecture.md](../../docs/admin-api/architecture.md) for
the full design and the query/command separation this service exists to
enforce. admin-api ran its own Kafka-projected read model through
Phase 4/5; that's been retired in favor of reading core-api directly —
see [docs/admin-api/query-apis.md](../../docs/admin-api/query-apis.md).

This is additive scope, not part of the original 8-phase plan in the repo
root [AGENTS.md](../../AGENTS.md) — see that file's phase map and
[docs/admin-api/overview.md](../../docs/admin-api/overview.md) for how
admin-api's own phases relate to it.

**Status: all 7 phases complete, plus post-Phase-7 additive scope.**
Phase 5's 11 query endpoints, Phase 6's command endpoints (forward to
core-api's `internal/v1/*` — see
[ADR 0010](../../docs/decisions/0010-internal-service-authentication.md)) —
now 9 driver/trip/payment commands (`approve`/`suspend`/`unsuspend`/
`disable` for drivers, `cancel` for trips, `refund` for payments) plus
admin account management (list/change-role/deactivate, super_admin-only)
— and Phase 7's realtime module: a throttled, region-scoped live driver
map and live driver counters sourced directly from dispatch-service's own
Redis index (`dispatch:driver:{id}` — the only Redis reads in admin-api
beyond a health ping), plus a computed incident feed (stale-searching
rides, drivers gone silent mid-trip). See
[docs/admin-api/laravel-integration.md](../../docs/admin-api/laravel-integration.md),
[docs/admin-api/realtime-operations.md](../../docs/admin-api/realtime-operations.md),
and [docs/admin-api/overview.md](../../docs/admin-api/overview.md) for the
full detail.

## Structure

```
src/
  main.ts                    Bootstrap: helmet, CORS, body limits, global pipe, Swagger, global prefix, listen
  app.module.ts               Root wiring: config, logger, throttler, postgres, health, metrics, audit, auth, query modules
  config/                     Joi-validated environment config (fails fast on boot)
  common/
    middleware/                Correlation-ID middleware
    interceptors/               Response envelope ({ data: ... })
    filters/                     Global exception filter ({ error: { code, message, correlation_id } })
    pagination/                  Shared PaginationQueryDto, PaginatedResponse<T> — cursors are opaque strings core-api encodes/decodes, admin-api just forwards them
  health/                      /health (liveness), /ready (Redis/core-api/Postgres indicators — no Kafka indicator anymore)
  metrics/                     /metrics (Prometheus text exposition, own Registry)
  integrations/
    postgres/                   Shared pg.Pool, connected as the admin_api role — auth-only (personal_access_tokens/users/admins), no admin_read schema anymore
    core-api/                    CoreApiClientService — the only place any call to core-api is made, both commands (PATCH) and queries (GET)
    redis/                       Shared persistent ioredis client (REDIS_CLIENT) — realtime module's read-only Redis reads
  modules/
    auth/                       TokenVerificationService, AuthGuard, PermissionsGuard, GET /api/v1/admin/session
    audit/                       AuditService — structured-log mirror only; the durable record is core-api's own audit_logs table
    dashboard/                   GET /dashboard/summary, /dashboard/regions — proxies core-api's internal/v1/dashboard/*
    drivers/                     GET /drivers, /drivers/:id, POST /drivers/:id/{approve,suspend,unsuspend,disable}
    rides/                       GET /rides, /rides/:id (+ timeline), /rides/:id/offers (+ is_expired)
    trips/                       GET /trips, /trips/:id (+ timeline), POST /trips/:id/cancel
    payments/                    GET /payments, /payments/:id, POST /payments/:id/refund
    realtime/                    GET /realtime/regions/:id/{drivers,counters}, /realtime/incidents — the only Redis-backed reads beyond health checks
    admins/                      GET /admins, PATCH /admins/:id/{role,deactivate} — admin account management, super_admin-only
```

## Running locally

Requires the Phase 1 infrastructure up (`docker compose up -d` from the
repo root), core-api running (for the `/ready` core-api indicator, login,
and `admin:create`), and at least one admin account:

```bash
cd apps/core-api
php artisan migrate   # creates the admin_api role, if not already applied
php artisan admin:create you@example.com "Your Name" super_admin --password=ChangeMe123

cd ../admin-api
cp .env.example .env   # ADMIN_API_POSTGRES_DSN's password must match ADMIN_API_DB_PASSWORD in apps/core-api/.env
npm install
npm run start:dev
```

## Manual verification

```bash
curl http://localhost:3001/health
curl http://localhost:3001/ready
curl http://localhost:3001/metrics

# Correlation id: reused if supplied, generated + echoed back otherwise
curl -i http://localhost:3001/health -H "X-Correlation-Id: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d"

# Error envelope (404 on an undefined route)
curl -i http://localhost:3001/nope

# Auth chain, end to end — log in against core-api, then call admin-api
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"ChangeMe123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['meta']['token'])")
curl http://localhost:3001/api/v1/admin/session -H "Authorization: Bearer $TOKEN"

# Without a token: 401
curl -i http://localhost:3001/api/v1/admin/session

# Drivers list, reading live from core-api (no Kafka, no projection lag)
curl http://localhost:3001/api/v1/admin/drivers -H "Authorization: Bearer $TOKEN"
```

Swagger/OpenAPI UI (non-production only, same convention as core-api's
`GET /docs`): [http://localhost:3001/docs](http://localhost:3001/docs).

## Tests

```bash
npx jest
```

`src/modules/auth/guards/permissions.guard.spec.ts` — the permission-
matching logic (`'*'` wildcard, AND-ed requirements, missing-permission
rejection). `AuthGuard`/`TokenVerificationService`'s Postgres-dependent
behavior is verified live instead (see
[docs/admin-api/authentication.md](../../docs/admin-api/authentication.md)'s
"What's proven live vs. unit-tested" section) — no mocked-Postgres
integration test exists, since a real round-trip against the actual
`admin_api` role is what actually matters here.
