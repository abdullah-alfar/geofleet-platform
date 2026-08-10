# ADR 0007: Retry topics, DLQ, and inbox retention

## Status
Accepted

## Context
Phase 7 needed a real answer for "what happens when a Kafka consumer can't
process a message" — every consumer built in Phases 3–6 answers that today
with the same placeholder: retry a few times inline, then log an ERROR and
move on (offset committed anyway). That's an explicit, documented gap in
each of them (see `App\Console\Commands\ConsumeLocationUpdates`'s original
docblock, and `internal/kafka.Consumer.Run` in both Go services) — not a
bug, just something deferred to this phase.

### Scope: not every consumer gets a retry topic

The question that decided scope, per consumer: **if this message is
silently dropped forever, is anything permanently lost?**

| Consumer | Topic | Answer | Decision |
|---|---|---|---|
| core-api's `ConsumeLocationUpdates` | `driver.location.validated.v1` | Yes — a durable Postgres write (`trip_location_samples`) never happens, no other path produces it. | **Retry + DLQ.** |
| dispatch-service's matching handler | `ride.requested.v1` | Yes — a ride never gets matched; the customer just waits forever with no driver. | **Retry + DLQ.** |
| dispatch-service's `internal/indexconsumers` | `driver.location.validated.v1`, `driver.status.changed.v1` | No — Redis SADD/SREM/HSET are idempotent by construction (ADR 0005); the driver's *next* location/status update fully repairs any missed state. | Excluded — self-healing. |
| realtime-gateway's five relay handlers | `ride.requested.v1`, `ride.offer.created.v1`, `ride.assigned.v1`, `ride.unavailable.v1`, `driver.location.validated.v1` | No — the domain event was already durably handled by its true owner service (dispatch-service/core-api); a missed *push* just means the client falls back to a poll it already has (see ADR 0006's `ride.unavailable.v1` and `GET /ride-requests/{id}` note). | Excluded — best-effort by design, documented fallback exists. |

This is also why realtime-gateway needed **no code changes** in this
phase: it was already built (Phase 6) with the right failure semantics for
its own risk profile, before this phase existed to name that risk profile
explicitly.

### Mechanism: an isolated retry-topic consumer, not a delayed-retry queue

Kafka has no native per-message delay. Two ways to get a "try again in 30
seconds" effect were considered:

1. A staged/tiered set of delay topics (`.retry-30s`, `.retry-2m`,
   `.retry-10m`) consumed by a scheduler that dispatches each message once
   its delay has elapsed.
2. A single `.retry` topic whose consumer simply **sleeps** the backoff
   duration before reprocessing each message, re-publishing to the same
   topic (with an incremented attempt count) if it fails again.

Chose (2). It's a fraction of the code, reuses `internal/kafka.Consumer`
(dispatch-service) and the exact same `KafkaConsumer` setup
`ConsumeLocationUpdates` already uses (core-api) verbatim, and at this
platform's failure volume (retry topics only ever carry *failures*, never
production traffic) a single-threaded consumer blocking on `sleep()`/
`time.After()` per message is not a real throughput concern.

**The one thing that had to be true for (2) to be safe: the retry-topic
consumer must be a fully separate consumer from the main topic** — its own
consumer group, its own goroutine (dispatch-service) or its own OS process
(core-api, since PHP has no goroutine equivalent). A multi-minute
`sleep()` inside the *main* topic's consumer would block every other
message behind it in that fetch batch, including brand-new
`ride.requested.v1` traffic that has nothing to do with the failure being
retried — unacceptable for a latency-sensitive matching path. This is why
`cmd/dispatch-service/main.go` runs two `kafka.Consumer` instances (see
`internal/reliability`), and why core-api ships
`kafka:consume-location-updates-retry` as a distinct artisan command
rather than a second topic subscription on the existing one.

**Backoff schedule: `30s, 2m, 10m`** (`reliability.BackoffSchedule` / PHP's
`ConsumeLocationUpdatesRetry::BACKOFF_SECONDS`) — three attempts, roughly
covering "blip," "brief outage," and "someone needs to be paged" before
giving up. Not configurable via environment variable yet; revisit if a
real incident shows a different shape is needed.

### The retry/DLQ envelope is not the standard event envelope

`RetryEnvelope` (`internal/reliability` in Go, `App\Domain\Reliability\RetryEnvelope`
in PHP) wraps `{original_topic, attempt, first_failed_at, last_error,
payload}`, where `payload` is the original message's envelope, unmodified.
This is deliberately a different shape from
[the standard event envelope](../events/event-envelope.md) — a `.retry`/
`.dlq` topic is an operational artifact of this platform's failure
handling, not a domain event, and nothing should ever become a Kafka
*consumer* of it in the normal sense (no service subscribes to
`ride.requested.v1.dlq` as part of its business logic). Keeping the shape
visibly different is a guardrail against that mistake, and is also exactly
what `scripts/kafka-replay-dlq.sh` needs to reconstruct the original
message for replay.

### No automatic DLQ consumer

Nothing consumes a `.dlq` topic automatically. A message lands there only
after 4 total attempts (1 inline + 3 backoff) have failed — at that point,
whatever's wrong is very unlikely to be fixed by trying a 5th time without
a human looking at it. The DLQ is an inspection queue; `Log::error`/
`logger.Error` at the point of DLQ publish is the paging signal, and
[docs/events/retry-and-dlq.md](../events/retry-and-dlq.md) documents the
manual replay procedure (`scripts/kafka-replay-dlq.sh`) for after the root
cause is fixed.

### Inbox retention

`inbox_events` (Phase 4) had no retention — every successfully processed
event leaves a row there forever. Safe to prune anything older than
Kafka's own topic retention (`log.retention.hours`, 168h/7d default — see
`infrastructure/kafka/init-topics.sh`): a row that old can never be
redelivered by Kafka again, so there's nothing left for it to deduplicate
against. `inbox:prune` (default: keep 8 days, one day of safety margin)
is registered on Laravel's scheduler (`routes/console.php`) rather than
needing its own always-running loop like `outbox:publish` — a daily
cadence is exactly what the built-in scheduler is for.

The replay path composes with this correctly with no special-casing: a
replayed message is, by definition, one that never successfully completed
(that's why it was in the DLQ), so it has no `inbox_events` row yet, and
reprocessing it via the normal consumer proceeds exactly like first-time
delivery.
