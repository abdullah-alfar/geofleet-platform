# Ride-Hailing & Fleet-Tracking Platform

An event-driven ride-hailing and fleet-tracking platform: Laravel core
business API, three Go real-time services, Kafka as the only inter-service
event bus, PostgreSQL/PostGIS as the system of record, Redis for live
derived state.

See [AGENTS.md](AGENTS.md) for the working agreement and hard invariants
(transactional outbox, inbox idempotency, atomic ride acceptance, etc.) —
read it before contributing.

## Status

**Phase 1 of 8: Local infrastructure.** Only Docker Compose, PostgreSQL/
PostGIS, Kafka, and Redis exist so far — no application code yet. See the
phase map in `AGENTS.md`.

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
| `postgres` | PostgreSQL 16 + PostGIS 3.4 | `5432` |
| `redis` | Redis 7.4, password-protected | `6379` |
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

## Documentation

Start with [docs/architecture/system-context.md](docs/architecture/system-context.md)
for the system-level view, and the ADRs in
[docs/decisions/](docs/decisions/) for why Kafka, PostgreSQL/PostGIS, and
the monorepo structure were chosen. Further architecture, event, and
database docs are added as their corresponding phases land.
