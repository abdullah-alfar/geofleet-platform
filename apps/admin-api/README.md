# admin-api

NestJS 11 / TypeScript. The Admin BFF for the GeoFleet platform — serves
the administrative dashboard by reading and writing core-api's own
Postgres tables **directly**, with its own broadened least-privilege
role, and has its own independent login/session system
(`admin_sessions`). No HTTP calls to core-api at all — see
[ADR 0011](../../docs/decisions/0011-admin-api-independent-service.md)
for the full reasoning, including why this is safe against a shared
database (the transactional outbox is insert-source-agnostic; core-api's
own unmodified publish loop picks up admin-api's `outbox_events` inserts
the same way it picks up its own).

This has gone through three distinct read-path designs over this
project's life — a Kafka-projected read model (Phase 4/5), then a thin
proxy calling core-api's `internal/v1` API (Phase 6/7), now direct SQL
(current) — see
[docs/admin-api/query-apis.md](../../docs/admin-api/query-apis.md) for
the full history. [docs/admin-api/architecture.md](../../docs/admin-api/architecture.md)
narrates all of it, oldest to newest.

**Status: all 7 original phases complete, plus Phase 8 (ADR 0011) —
independent service.** 11 query endpoints across dashboard/drivers/
rides/trips/payments/customers, 9 write commands (`approve`/`suspend`/
`unsuspend`/`disable` for drivers, `cancel` for trips, `refund` for
payments, plus admin account management — role change/deactivate,
super_admin-only), and the realtime module: a throttled, region-scoped
live driver map and live driver counters sourced directly from
dispatch-service's own Redis index (`dispatch:driver:{id}` — the only
Redis reads in admin-api beyond a health ping), plus a computed incident
feed (stale-searching rides, drivers gone silent mid-trip) — the one
part of this service unaffected by the Phase 8 change, see
[docs/admin-api/realtime-operations.md](../../docs/admin-api/realtime-operations.md).

## Structure

```
src/
  main.ts                    Bootstrap: helmet, CORS, body limits, global pipe, Swagger, global prefix, listen
  app.module.ts               Root wiring: config, logger, throttler, postgres, redis, health, metrics, audit, auth, query modules
  config/                     Joi-validated environment config (fails fast on boot)
  common/
    middleware/                Correlation-ID middleware
    interceptors/               Response envelope ({ data: ... })
    filters/                     Global exception filter ({ error: { code, message, correlation_id } })
    pagination/                  cursor.ts — keyset pagination admin-api now does itself (port of core-api's App\Support\CursorPagination), shared by every list query
    resolve-admin-id.ts          uuid -> bigint id lookup for the acting admin, shared by every write module's audit insert
    admin-permissions.ts         Role -> abilities map, ported from core-api's App\Support\AdminPermissions (login now happens here, so this map moved too)
    phone-mask.ts                Ported from core-api's App\Support\PhoneMask
  health/                      /health (liveness), /ready (Redis/Postgres indicators — no core-api indicator anymore, no runtime dependency on it left)
  metrics/                     /metrics (Prometheus text exposition, own Registry)
  integrations/
    postgres/                   Shared pg.Pool, connected as the admin_api role — broadened past auth-only, see ADR 0011
    redis/                       Shared persistent ioredis client (REDIS_CLIENT) — realtime module's read-only Redis reads
  modules/
    auth/                       AdminAuthService (own login), TokenVerificationService (admin_sessions), AuthGuard, PermissionsGuard, GET /api/v1/admin/session
    audit/                       AuditService — structured-log mirror only; the durable record is audit_logs, written directly by each write module now
    dashboard/                   GET /dashboard/summary, /dashboard/regions — live COUNT/aggregate SQL against core-api's own tables
    drivers/                     GET /drivers, /drivers/:id, POST /drivers/:id/{approve,suspend,unsuspend,disable} — direct SQL, the fully-annotated reference module
    rides/                       GET /rides, /rides/:id (+ timeline), /rides/:id/offers (+ is_expired) — read-only
    trips/                       GET /trips, /trips/:id (+ timeline), POST /trips/:id/cancel
    payments/                    GET /payments, /payments/:id, POST /payments/:id/refund
    customers/                   GET /customers, /customers/:id (+ total_rides/total_trips) — read-only, no command endpoints
    realtime/                    GET /realtime/regions/:id/{drivers,counters}, /realtime/incidents — Redis-backed live state + DriversService/RidesService/TripsService called directly (same process, not HTTP)
    admins/                      GET /admins, PATCH /admins/:id/{role,deactivate} — admin account management, super_admin-only, both self-protection guards enforced
```

## Running locally

Requires the Phase 1 infrastructure up (`docker compose up -d` from the
repo root), core-api's migrations applied at least once (they create and
broaden the `admin_api` Postgres role and the `admin_sessions` table —
core-api's own process doesn't need to be running afterward, admin-api
has no runtime dependency on it), and at least one admin account:

```bash
cd apps/core-api
php artisan migrate   # creates + broadens the admin_api role, creates admin_sessions
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

# Auth chain, end to end — admin-api handles login itself now, no core-api call
TOKEN=$(curl -s -X POST http://localhost:3001/api/v1/admin/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"ChangeMe123"}' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['token'])")
curl http://localhost:3001/api/v1/admin/session -H "Authorization: Bearer $TOKEN"

# Without a token: 401
curl -i http://localhost:3001/api/v1/admin/session

# Drivers list — direct SQL against core-api's own tables, no HTTP call to core-api anywhere in this path
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
