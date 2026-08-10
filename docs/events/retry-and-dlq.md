# Retry Topics and Dead-Letter Queues

Operational reference for this platform's retry/DLQ topics — what they
are, when a message lands in one, and how to get it back out. See
[ADR 0007](../decisions/0007-retry-dlq-strategy.md) for why this design
was chosen; this document is the runbook.

## Which topics have a retry/DLQ pair

Only two, deliberately — see ADR 0007's scope table for why the rest of
this platform's consumers don't need one.

| Source topic | Retry topic | DLQ topic | Owning consumer |
|---|---|---|---|
| `driver.location.validated.v1` | `driver.location.validated.v1.retry` | `driver.location.validated.v1.dlq` | core-api's `kafka:consume-location-updates` |
| `ride.requested.v1` | `ride.requested.v1.retry` | `ride.requested.v1.dlq` | dispatch-service's matching handler |

## The envelope

Every message on a `.retry` or `.dlq` topic has this shape (not the
[standard event envelope](event-envelope.md) — see ADR 0007):

```json
{
  "original_topic": "ride.requested.v1",
  "attempt": 2,
  "first_failed_at": "2026-08-15T09:12:03Z",
  "last_error": "matching: load ride request: dial tcp 127.0.0.1:55432: connect: connection refused",
  "payload": { "...": "the original event envelope, unmodified" }
}
```

- `attempt` starts at 1 the moment a message first lands on `.retry`, and
  increments each time the retry-topic consumer tries again and fails. A
  message on `.dlq` shows the attempt count it was abandoned at (currently
  always 3, `len(BackoffSchedule)`/`count(BACKOFF_SECONDS)`).
- `payload` is what gets republished, unchanged, if you replay the
  message — see below.

## What actually happens to a failing message

1. The main consumer's normal fast-retry (a few attempts, sub-second
   backoff — unchanged from earlier phases) is exhausted.
2. It's published to `{topic}.retry`, attempt 1.
3. A **separate, isolated** consumer (own consumer group — see ADR 0007
   for why it must be isolated) picks it up, waits 30s, and tries again.
4. Still failing → waits 2m, tries again (attempt 2).
5. Still failing → waits 10m, tries again (attempt 3).
6. Still failing → published to `{topic}.dlq`. This is logged at ERROR
   (`location_retry_consumer.attempts_exhausted` / `reliability: retry
   attempts exhausted, routing to DLQ`) — that log line is the paging
   signal; nothing else watches the DLQ automatically.

Total time from first failure to DLQ: a little over 12 minutes.

## Inspecting a retry/DLQ topic

```bash
docker compose exec kafka /opt/kafka/bin/kafka-console-consumer.sh \
  --bootstrap-server localhost:9092 \
  --topic ride.requested.v1.dlq \
  --from-beginning \
  --timeout-ms 5000
```

## Replay procedure

**First, fix the root cause.** Replaying without fixing whatever made the
message fail in the first place just re-populates the same retry/DLQ
topic a few minutes later.

Then:

```bash
scripts/kafka-replay-dlq.sh ride.requested.v1.dlq
```

This drains every message currently on the given topic and republishes
each one's `payload` onto its `original_topic`, preserving the original
partition key. From there it flows through the normal consumer exactly
like a first-time delivery — safe to do even if the message had partially
succeeded before originally failing, because every consumer that matters
here is idempotent via the inbox pattern (`inbox_events`, see AGENTS.md)
or, for dispatch-service, the atomic-acceptance `UPDATE` that makes
re-running the matching cycle for an already-resolved ride request a
guaranteed no-op (`internal/matching.Matcher.RunCycle`'s status guard).

If you only want to inspect a `.retry` topic's contents without waiting
for its backoff schedule to run its course, the same script works on
`.retry` topics too — it replays whatever's currently there back onto the
*original* topic (not back onto `.retry`), which re-enters the message at
the front of the normal fast-retry path rather than waiting out the rest
of the backoff schedule.

## Inbox retention

`inbox_events` rows are pruned by `php artisan inbox:prune` (registered
daily on Laravel's scheduler — requires `php artisan schedule:work`
running locally, or a real cron entry calling `php artisan schedule:run`
every minute in production). Default retention: 8 days. Safe because a
row that old can never be redelivered by Kafka again (7-day default topic
retention) — see ADR 0007.
