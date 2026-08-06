# ADR 0001: Use Kafka instead of Redis queues, RabbitMQ, or SQS-style queues

## Status
Accepted

## Context
The platform needs a communication backbone between independently scalable
services: Laravel core-api, the Go location-service, dispatch-service, and
realtime-gateway. Candidates considered:

- **Redis queues / streams** — already in the stack for other purposes, low
  operational overhead, but weak durability guarantees under Redis restarts
  unless AOF is tuned carefully, no first-class consumer-group replay, and
  retention is memory-bound rather than time-bound.
- **RabbitMQ** — mature, good routing semantics, but message deletion on ack
  makes replay and multiple independent consumer groups reading the same
  stream at different offsets awkward without extra plugins.
- **Kafka** — durable, time- and size-bound log retention, native consumer
  groups, replay by offset reset, partition-level ordering keyed by
  aggregate ID, and a large ecosystem (Kafka Connect, Debezium) for future
  CDC-based outbox publishing.

The domain has requirements that specifically favor a log-structured broker:
GPS events need per-driver ordering at high throughput; ride/trip lifecycle
events need replay for debugging and for late-joining consumers (e.g. an
analytics service added later); at-least-once delivery with idempotent
consumers is an explicit design requirement, which Kafka's offset model
supports directly.

## Decision
Use Apache Kafka as the only inter-service broker. Do not use Redis
queues, RabbitMQ, or any other broker for domain/integration events.
Redis remains in the stack, but only for live derived state (latest
location, presence, offer TTLs) — never as an event transport between
services.

## Consequences
- Every Go service and Laravel must speak Kafka; adds an operational
  component beyond what a queue-only design would need, but this is bounded
  by Docker Compose in local dev (see ADR 0003).
- Consumers must be written idempotently (inbox pattern) since Kafka only
  guarantees at-least-once delivery here — this is treated as a hard
  requirement, not a nice-to-have (documented in
  `docs/events/retry-and-dlq.md`, added in a later phase).
- Local dev runs a single-broker, single-partition-replica KRaft cluster.
  This is intentionally not representative of production replication
  factor — partition *count* is chosen for future scale (see
  `docs/events/topic-catalog.md`, added when Phase 2 introduces the outbox
  publisher), but replication factor is a deployment-time concern.
- We explicitly do not claim exactly-once delivery anywhere in this system.
