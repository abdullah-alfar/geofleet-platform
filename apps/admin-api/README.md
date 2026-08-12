# admin-api

NestJS 11 / TypeScript. The Admin BFF for the GeoFleet platform — serves
the administrative dashboard by aggregating Kafka-derived read models and
forwarding operational commands to core-api's internal API. Does not own
core business domain data or mutate Laravel-owned tables directly. See
[docs/admin-api/overview.md](../../docs/admin-api/overview.md) and
[docs/admin-api/architecture.md](../../docs/admin-api/architecture.md) for
the full design and the query/command separation this service exists to
enforce.

This is additive scope, not part of the original 8-phase plan in the repo
root [AGENTS.md](../../AGENTS.md) — see that file's phase map and
[docs/admin-api/overview.md](../../docs/admin-api/overview.md) for how
admin-api's own phases relate to it.

**Status: Phase 4 of 8 — Kafka projection consumers.** One consumer
(group `admin-api`), 9 live topics, idempotent per-handler inbox pattern.
Live-verified: real historical replay (7-day Kafka retention) populated
hundreds of real rows on first connect; fresh traffic from
`scripts/loadtest` produced exact, correct deltas; restart-idempotency
confirmed no reprocessing. See
[docs/admin-api/overview.md](../../docs/admin-api/overview.md) for the
full phase plan.

## Structure

```
src/
  main.ts                    Bootstrap: helmet, CORS, body limits, global pipe, Swagger, global prefix, listen
  app.module.ts               Root wiring: config, logger, throttler, postgres, database, health, metrics, audit, auth, kafka
  config/                     Joi-validated environment config (fails fast on boot)
  common/
    middleware/                Correlation-ID middleware
    interceptors/               Response envelope ({ data: ... })
    filters/                     Global exception filter ({ error: { code, message, correlation_id } })
    types/                       Express Request augmentation (correlationId, admin), kafkajs-snappy ambient types
  health/                      /health (liveness), /ready (Redis/Kafka/core-api/Postgres indicators)
  metrics/                     /metrics (Prometheus text exposition, own Registry)
  integrations/
    postgres/                   Shared pg.Pool, connected as the admin_api role (search_path: admin_read, public)
    kafka/                       KafkaConsumerService (9 live topics, fromBeginning), envelope parsing/validation
  database/
    schema.ts                   Typed Database interface for every admin_read table
    database.module.ts          Kysely<Database> DI provider, wraps the shared pg.Pool
    migrate.ts                   Standalone migration CLI (npm run migrate -- up|down|status)
    migrations/                  admin_consumer_inbox, driver/ride/ride-offer/trip/payment projections, region_metrics
  projections/
    projection-dispatcher.service.ts   Inbox-checked, transactional event_type -> handler routing
    handlers/                    One handler class per live event_type (9 total)
  modules/
    auth/                       TokenVerificationService, AuthGuard, PermissionsGuard, GET /api/v1/admin/session
    audit/                       AuditService — structured-log-only foundation, durable storage not yet needed
```

## Running locally

Requires the Phase 1 infrastructure up (`docker compose up -d` from the
repo root), core-api running (for the `/ready` core-api indicator, login,
and `admin:create`), and at least one admin account:

```bash
cd apps/core-api
php artisan migrate   # creates the admin_api role + admin_read schema, if not already applied
php artisan admin:create you@example.com "Your Name" super_admin --password=ChangeMe123

cd ../admin-api
cp .env.example .env   # ADMIN_API_POSTGRES_DSN's password must match ADMIN_API_DB_PASSWORD in apps/core-api/.env
npm install
npm run migrate -- up   # creates the admin_read tables (idempotent — safe to re-run)
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

# Projections populating (needs the Kafka consumer running — check logs
# for "Kafka consumer running: group \"admin-api\"", then generate real
# traffic, e.g. cd scripts/loadtest && go run . -drivers=5 -customers=3)
docker compose exec postgres psql -U core_api -d core_api \
  -c "SELECT count(*) FROM admin_read.admin_ride_projection;"
```

Swagger/OpenAPI UI (non-production only, same convention as core-api's
`GET /docs`): [http://localhost:3001/docs](http://localhost:3001/docs).

## Database migrations

```bash
npm run migrate -- status   # list applied/pending migrations
npm run migrate -- up       # migrate to latest
npm run migrate -- down     # roll back one migration
```

See [docs/admin-api/read-models.md](../../docs/admin-api/read-models.md)
for the schema itself and why each index exists.

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
