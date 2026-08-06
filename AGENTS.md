# AGENTS.md

Working agreement for any human or AI agent contributing to this repository.
Read this before making changes. If it conflicts with something you were
told in a chat prompt, this file wins for anything not explicitly
overridden in that prompt.

## What this repository is

A production-oriented, event-driven ride-hailing and fleet-tracking
platform: Laravel core-api + three Go services (location, dispatch,
realtime-gateway), communicating over Kafka, backed by PostgreSQL/PostGIS
and Redis. Full requirements and target architecture are captured in the
Phase 0 audit conversation and progressively in `docs/`.

## Non-negotiable technology decisions

- Laravel 13, PHP compatible with Laravel 13.
- Go 1.26.3 for all Go services.
- PostgreSQL + PostGIS as the only durable system of record.
- **Kafka only** for inter-service events. Never substitute Redis
  queues/streams, RabbitMQ, or any other broker for domain/integration
  events (ADR 0001). Redis is for live derived state only (latest
  location, presence, offer TTLs, geo-cell membership) — not for
  cross-service event transport.
- Docker Compose for local orchestration. **No Kubernetes** in this repo's
  first implementation — design for it, don't build it.

## Hard invariants

- **Transactional outbox**: Laravel must never commit a domain write and
  then publish to Kafka as a separate, unrelated operation. The domain row
  and the `outbox_events` row are written in the same PostgreSQL
  transaction; a separate publisher process reads and publishes them.
- **Inbox / idempotent consumers**: any Kafka consumer that causes a
  durable state change must record processed event IDs with a unique
  constraint on `(consumer_name, event_id)` and skip duplicates. At-least-
  once delivery is the assumption everywhere — never claim exactly-once.
- **Atomic ride acceptance**: driver assignment uses a single conditional
  `UPDATE ... WHERE status = 'searching'` (or equivalent), never a
  read-then-write. Exactly one row affected means exactly one driver won.
- **PostGIS point order is `(longitude, latitude)`** — the opposite of how
  coordinates are normally spoken. Every call site constructing a point
  must get this right; get it wrong and data silently lands in the wrong
  hemisphere.
- **Public identifiers are UUID/ULID**, never predictable sequential IDs,
  on anything exposed through an API.
- **Raw GPS pings are not retained forever in PostgreSQL.** Only sampled
  trip routes and business-state transitions are durable there; raw
  high-frequency GPS lives briefly in Kafka and as "latest value" in Redis.
- **`region_id`** is carried on relevant records and event envelopes from
  the start, even though local dev only uses one region (`amman`), so
  multi-region routing is additive later, not a migration.

## Working style for this repo

- Work in small, reviewable phases (see the phase list below). Explain the
  goal and the architectural decision before implementing. Don't jump
  ahead to a later phase's concerns (e.g. don't build DLQ/retry topics
  before Phase 7 — the topic catalog in Phase 1 intentionally excludes
  them).
- Don't over-engineer the first version. A bug fix doesn't need a
  refactor; a one-shot script doesn't need a framework. Three similar
  lines beat a premature abstraction.
- Before adding an index, explain the query it supports.
- Don't run heavy test suites, load tests, full Docker rebuilds, Composer
  updates, or npm builds unless explicitly requested.
- Use Architecture Decision Records (`docs/decisions/`) for decisions with
  lasting consequences, not for routine implementation choices.

## Phase map (for orientation — see README.md for current status)

0. Repository & architecture audit
1. Local infrastructure (Docker Compose, Postgres/PostGIS, Kafka, Redis)
2. Laravel core: auth, schema, outbox, base API, OpenAPI foundation
3. Go location-service: GPS ingestion, validation, Redis, Kafka publish
4. Kafka consumers + live location (idempotency, PostGIS sampling)
5. Go dispatch-service: matching, offers, atomic acceptance
6. Go realtime-gateway: WebSockets, subscriptions, multi-instance fan-out
7. Reliability: retry topics, DLQ, inbox hardening, replay procedures
8. Scalability validation: lightweight load tools, capacity analysis

## Where things live

- `apps/` — the four deployable services, each with its own dependency
  manifest.
- `contracts/` — event schemas (`contracts/events/`) and the OpenAPI spec
  (`contracts/openapi/`), shared across services.
- `infrastructure/` — Docker Compose init scripts/configs for Postgres,
  Kafka, Redis.
- `docs/` — architecture, event, database docs, and ADRs. Docs are added
  alongside the phase that makes them concrete, not written speculatively
  ahead of the code.
