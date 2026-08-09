# Ride-Hailing & Fleet-Tracking Platform

An event-driven ride-hailing and fleet-tracking platform: Laravel core
business API, three Go real-time services, Kafka as the only inter-service
event bus, PostgreSQL/PostGIS as the system of record, Redis for live
derived state.

See [AGENTS.md](AGENTS.md) for the working agreement and hard invariants
(transactional outbox, inbox idempotency, atomic ride acceptance, etc.) —
read it before contributing.

## Status

**Phase 4 of 8: Kafka consumers and live location.** Local infrastructure
(Phase 1) + Laravel core-api (Phase 2) + Go location-service (Phase 3) +
core-api's `kafka:consume-location-updates`: idempotently samples validated
GPS updates into a partitioned Postgres table
(`trip_location_samples`) for active trips, and republishes them as
trip-keyed `trip.location.updated.v1` events via the transactional outbox.
dispatch-service and realtime-gateway don't exist yet. See the phase map in
`AGENTS.md`.

## Repository layout

```
apps/
  core-api/            Laravel 13 — business logic, outbox, admin (Phase 2)
  location-service/    Go 1.26.3 — GPS ingestion (Phase 3)
  dispatch-service/    Go 1.26.3 — driver matching (Phase 5)
  realtime-gateway/     Go 1.26.3 — WebSockets (Phase 6)
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

## Documentation

Start with [docs/architecture/system-context.md](docs/architecture/system-context.md)
for the system-level view, the ADRs in [docs/decisions/](docs/decisions/)
for why Kafka, PostgreSQL/PostGIS, and the monorepo structure were chosen,
and [docs/events/event-envelope.md](docs/events/event-envelope.md) +
[docs/events/topic-catalog.md](docs/events/topic-catalog.md) for the Kafka
event contract every service follows. Further architecture and database
docs are added as their corresponding phases land.
