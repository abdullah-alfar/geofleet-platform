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

**Status: Phase 1 of 8 — foundation only.** No business modules, no
authentication, no database, no Kafka consumers yet — see
[docs/admin-api/overview.md](../../docs/admin-api/overview.md) for the
full phase plan.

## Structure

```
src/
  main.ts                    Bootstrap: helmet, CORS, body limits, global pipe, Swagger, listen
  app.module.ts               Root wiring: config, logger, throttler, health, metrics
  config/                     Joi-validated environment config (fails fast on boot)
  common/
    middleware/                Correlation-ID middleware
    interceptors/               Response envelope ({ data: ... })
    filters/                     Global exception filter ({ error: { code, message, correlation_id } })
    types/                       Express Request augmentation (correlationId)
  health/                      /health (liveness), /ready (Redis/Kafka/core-api indicators)
  metrics/                     /metrics (Prometheus text exposition, own Registry)
  modules/                     Business modules — empty until Phase 2+
  integrations/                Kafka/Laravel/Redis clients — empty until Phase 4/6
  database/                    Migrations/entities/repositories — empty until Phase 3
```

## Why no Postgres health check yet

`/ready` checks Redis, Kafka, and core-api, but not Postgres — admin-api
has no database role or schema of its own until Phase 3 creates
`admin_api`/`admin_read`. See the comment in
[src/health/health.module.ts](src/health/health.module.ts).

## Running locally

Requires the Phase 1 infrastructure up (`docker compose up -d` from the
repo root) and core-api running (for the `/ready` core-api indicator and,
from Phase 6 onward, command forwarding).

```bash
cd apps/admin-api
cp .env.example .env
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
```

Swagger/OpenAPI UI (non-production only, same convention as core-api's
`GET /docs`): [http://localhost:3001/docs](http://localhost:3001/docs).

## Tests

None yet — Phase 1 is framework wiring with no business logic to unit
test. Tests start with Phase 2 (permission guards) per
[docs/admin-api/overview.md](../../docs/admin-api/overview.md)'s phase
plan.
