# Ride-Hailing & Fleet-Tracking Platform

An event-driven ride-hailing and fleet-tracking platform: Laravel core
business API, three Go real-time services, Kafka as the only inter-service
event bus, PostgreSQL/PostGIS as the system of record, Redis for live
derived state.

See [AGENTS.md](AGENTS.md) for the working agreement and hard invariants
(transactional outbox, inbox idempotency, atomic ride acceptance, etc.) —
read it before contributing.

## Status

**Phase 8 of 8: Scalability validation — all planned phases complete.**
Local infrastructure (Phase 1) + Laravel core-api (Phase 2) + Go
location-service (Phase 3) + core-api's location consumer (Phase 4) + Go
dispatch-service (Phase 5) + Go realtime-gateway (Phase 6) + retry
topics/DLQ/inbox retention (Phase 7) + a lightweight load-testing tool and
a capacity analysis grounded in real measurements against this stack (Phase
8) — see the phase map in `AGENTS.md`,
[docs/architecture/scalability.md](docs/architecture/scalability.md), and
[ADR 0008](docs/decisions/0008-load-testing-approach.md).

The container diagram and Kafka data-flow doc `docs/architecture/system-context.md`
had flagged as deferred since Phase 0/2 are now built as a follow-up (not
any single phase's explicit deliverable) — see
[docs/architecture/container-diagram.md](docs/architecture/container-diagram.md)
and [docs/architecture/data-flow.md](docs/architecture/data-flow.md).

## Repository layout

```
apps/
  core-api/            Laravel 13 — business logic, outbox, admin (Phase 2)
  location-service/    Go 1.26.3 — GPS ingestion (Phase 3)
  dispatch-service/    Go 1.26.3 — driver matching (Phase 5)
  realtime-gateway/    Go 1.26.3 — WebSockets, fan-out (Phase 6)
  admin-api/           NestJS 11 — Admin BFF: read models + command forwarding (additive, see docs/admin-api/)
  admin-web/           Nuxt 4 — Admin dashboard UI, calls admin-api (additive, see apps/admin-web/README.md)
  landing-web/         Nuxt 4 — Public marketing/portfolio site, no backend calls (additive, see apps/landing-web/README.md)
contracts/
  events/               Event schemas shared across services
  openapi/              REST API specification
infrastructure/
  postgres/             DB init scripts (extensions)
  kafka/                Topic initialization
  redis/                Local dev config
  monitoring/           Prometheus/metrics config (later phase)
docs/
  architecture/          System context, container diagram, data flow, scalability
  events/                Event envelope, topic catalog, retry/DLQ strategy
  database/              Schema, indexes, partitioning, retention
  decisions/              Architecture Decision Records
scripts/                 Local developer tooling
```

## Quick start (local infrastructure only)

Requires Docker and Docker Compose.

```bash
cp .env.example .env
docker compose up -d
docker compose ps          # wait for postgres, redis, kafka to report healthy
docker compose logs kafka-init   # confirm topics were created
```

This brings up:

| Service | Purpose | Host port |
|---|---|---|
| `postgres` | PostgreSQL 16 + PostGIS 3.4 | `55432` (remapped off the standard 5432 — see `.env.example`) |
| `redis` | Redis 7.4, password-protected | `63790` (remapped off the standard 6379) |
| `kafka` | Single-node Kafka (KRaft mode) | `9094` (external listener) |
| `kafka-init` | One-shot job that creates the topic catalog, then exits | — |

### Manual verification

```bash
# Postgres is up and PostGIS is enabled
docker compose exec postgres psql -U core_api -d core_api -c "SELECT postgis_full_version();"

# Redis responds (password from .env)
docker compose exec redis redis-cli -a <REDIS_PASSWORD> ping

# Kafka topics were created
docker compose exec kafka /opt/kafka/bin/kafka-topics.sh --bootstrap-server localhost:9092 --list
```

Tear down (keeps volumes):

```bash
docker compose down
```

Tear down and wipe local data volumes:

```bash
docker compose down -v
```

## Quick start (core-api)

Requires PHP 8.4 with `pdo_pgsql` and `rdkafka` extensions, and Composer.
Run after the infrastructure above is up.

```bash
cd apps/core-api
composer install
cp .env.example .env    # already points at the infra ports above
php artisan migrate
php artisan serve --port=8000
```

In a second terminal, run the transactional outbox publisher (polls for
unpublished events and sends them to Kafka — see
`app/Console/Commands/PublishOutboxEvents.php`):

```bash
watch -n 2 php artisan outbox:publish
```

In a third terminal, run the location consumer (samples validated GPS
updates for active trips — see
`app/Console/Commands/ConsumeLocationUpdates.php`):

```bash
php artisan kafka:consume-location-updates
```

Optionally, a fourth terminal for its isolated retry-topic consumer (Phase
7 — see [docs/events/retry-and-dlq.md](docs/events/retry-and-dlq.md)):

```bash
php artisan kafka:consume-location-updates-retry
```

The OpenAPI spec for the resulting REST surface is at
[contracts/openapi/openapi.yaml](contracts/openapi/openapi.yaml). With
core-api running, an interactive Redoc-rendered version is at
[http://localhost:8000/docs](http://localhost:8000/docs) (local
environment only — 404s otherwise).

A ready-to-import Postman collection covering both core-api and
location-service is at
[contracts/postman/](contracts/postman/ridehailing-platform.postman_collection.json)
— import it along with
[local.postman_environment.json](contracts/postman/local.postman_environment.json)
and run requests top-to-bottom within a folder; register/login requests
auto-capture tokens and IDs for later requests to reuse.

## Quick start (location-service)

Requires Go 1.26.3. Run after core-api's migrations have been applied
(they create the least-privilege `location_service` Postgres role this
service connects with).

```bash
cd apps/location-service
cp .env.example .env
export $(grep -v '^#' .env | xargs)
go run ./cmd/location-service
```

See [apps/location-service/README.md](apps/location-service/README.md) for
the validation pipeline, Kafka topics, Redis key schema, and a sample
`curl` request.

## Quick start (dispatch-service)

Requires Go 1.26.3. Run after core-api's migrations have been applied
(they create the write-scoped `dispatch_service` Postgres role this
service connects with) — and ideally after location-service, so there's
real driver location data to match against.

```bash
cd apps/dispatch-service
cp .env.example .env
export $(grep -v '^#' .env | xargs)
go run ./cmd/dispatch-service
```

See [apps/dispatch-service/README.md](apps/dispatch-service/README.md) for
the matching cycle, the atomic-acceptance transaction, and the geohash
indexing strategy (and why it's geohash instead of H3 — see also
[docs/decisions/0005](docs/decisions/0005-geohash-and-dispatch-db-access.md)).

## Quick start (realtime-gateway)

Requires Go 1.26.3. Run after core-api's migrations have been applied
(they create the read-only `realtime_gateway` Postgres role this service
connects with) — and ideally after dispatch-service, so there are
ride-lifecycle events to relay.

```bash
cd apps/realtime-gateway
cp .env.example .env
export $(grep -v '^#' .env | xargs)
go run ./cmd/realtime-gateway
```

See [apps/realtime-gateway/README.md](apps/realtime-gateway/README.md) for
the WebSocket auth reuse, the Redis Pub/Sub fan-out design, and the two
correlation mappings that route events which don't carry a customer id
(and why — see also
[docs/decisions/0006](docs/decisions/0006-realtime-gateway-fanout.md)).

## Quick start (admin-api)

Requires Node 22 and core-api running (login + `admin:create` + the
`/ready` core-api indicator).

```bash
cd apps/core-api && php artisan admin:create you@example.com "You" super_admin --password=ChangeMe123

cd ../admin-api
cp .env.example .env
npm install
npm run migrate -- up
npm run start:dev
```

**Additive scope, not part of the 8-phase plan above.** admin-api is a
NestJS Admin BFF: it builds its own read models from Kafka events and
forwards operational commands to core-api's internal API rather than
mutating Laravel-owned tables — see
[docs/admin-api/overview.md](docs/admin-api/overview.md) and
[docs/admin-api/architecture.md](docs/admin-api/architecture.md) for the
full design and its own phase plan. **Status: Phase 7 of 8 — realtime
operations, all phases complete.** Phases 5-6 (query APIs + Laravel
command integration — see
[docs/admin-api/laravel-integration.md](docs/admin-api/laravel-integration.md)
and [ADR 0010](docs/decisions/0010-internal-service-authentication.md))
plus Phase 7: a throttled, region-scoped live driver map and live driver
counters sourced directly from dispatch-service's own Redis index, and a
computed incident feed (stale-searching rides, drivers gone silent
mid-trip) built from data this platform already has — no new domain
model. Live-verified against real `scripts/loadtest` traffic and, more
notably, against 86 real stuck ride requests already present in this
platform's data from earlier load-testing phases — a real operational gap
with no prior visibility. See
[docs/admin-api/realtime-operations.md](docs/admin-api/realtime-operations.md)
for the freshness bug (an orphaned Redis key that would have shown a
phantom driver at 0,0) and unbounded-query bug it caught live.

## Quick start (admin-web)

Requires Node 22 and admin-api running (see above) — admin-web has no
direct dependency on core-api's or admin-api's *databases*, only their
HTTP APIs.

```bash
cd apps/admin-web
cp .env.example .env
npm install
npm run dev
```

Open http://localhost:3000. Log in with an admin account created via
`php artisan admin:create` (see above).

**Additive scope** — the browser-based dashboard UI admin-api's own
architecture diagram always drew as out-of-scope, now built: Nuxt 4,
SPA mode (no SSR — an internal authenticated tool, no SEO need). Covers
every admin-api endpoint built so far — dashboard, drivers/rides/trips/
payments (filtered, cursor-paginated lists + detail views), the
suspend/cancel/refund commands, and the live driver map/counters/incident
feed — gated client-side by the same abilities admin-api enforces
server-side. See [apps/admin-web/README.md](apps/admin-web/README.md) for
the full structure and the auth flow (admins log in through core-api
directly, same as customers/drivers, then everything else goes through
admin-api).

## Load testing

Requires Go 1.26.3, core-api, location-service, and dispatch-service
running (realtime-gateway optional).

```bash
cd scripts/loadtest
go run . -drivers=50 -customers=20 -gps-duration=30s
```

Generates real traffic against the running stack and reports
latency/throughput from each service's own Prometheus metrics — see
[scripts/loadtest/README.md](scripts/loadtest/README.md) for the full flag
list and [docs/architecture/scalability.md](docs/architecture/scalability.md)
for the resulting capacity analysis.

## Documentation

Start with [docs/architecture/system-context.md](docs/architecture/system-context.md)
for the system-level view, the ADRs in [docs/decisions/](docs/decisions/)
for why Kafka, PostgreSQL/PostGIS, and the monorepo structure were chosen,
and [docs/events/event-envelope.md](docs/events/event-envelope.md) +
[docs/events/topic-catalog.md](docs/events/topic-catalog.md) for the Kafka
event contract every service follows. Further architecture and database
docs are added as their corresponding phases land.
