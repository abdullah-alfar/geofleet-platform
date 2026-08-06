# Retention Policies

What's enforced today vs. what's documented as a policy to implement later
— being explicit about the difference matters more than the policy itself
at this stage.

## Redis: latest driver location

**Enforced today.** `location:latest:{driver_id}` — TTL set on every write
(`LOCATION_TTL`, default 5 minutes — see
`apps/location-service/internal/redisstore`). A driver who stops sending
updates naturally disappears from "latest location" without any cleanup
job. This is the one retention policy in this list that's actually live
code, not just a documented intent.

## Redis: rate-limit counters

**Enforced today.** `location:ratelimit:{driver_id}` — TTL = the rate
limit window (default 1 second). Self-cleaning by construction.

## Postgres: sampled trip routes (`trip_location_samples`)

**Not yet enforced — documented policy, no pruning job exists.** Sampling
itself (avoiding storing every raw point) is enforced by
`App\Domain\Location\LocationSampler` (Phase 4). What's *not* built yet:
deleting old partitions. Recommended policy once implemented: retain
completed trips' route samples for a fixed window (e.g. 90 days) for
support/dispute resolution, then drop the whole month's partition
(`DROP TABLE trip_location_samples_y2026m01` — instant, no row-by-row
delete, see [partitioning.md](partitioning.md)). Longer-term archival
(e.g. to object storage) before dropping is a product decision, not an
infrastructure one — not decided here.

## Postgres: raw GPS data

**By design, never stored.** Raw per-update GPS traffic lives only in
Kafka (briefly, per the topic's own retention — see below) and Redis (as
"latest location", per above). Only the throttled samples described above
ever reach Postgres. This is a hard invariant, not a soft default — see
AGENTS.md: "Raw GPS pings are not retained forever in PostgreSQL."

## Postgres: audit_logs

**Not yet enforced — no pruning job exists.** The `occurred_at` index
(see [indexes.md](indexes.md)) exists specifically to support a future
retention job's "delete rows older than N" query. No specific retention
window is decided yet — this is a compliance/business decision (how long
does support/security need audit history?) that should be made explicitly
before writing the pruning job, not defaulted silently.

## Kafka topic retention

**Using Kafka's cluster/topic defaults — not yet tuned per-topic.**
`infrastructure/kafka/init-topics.sh` (Phase 1) creates topics without
custom `retention.ms`/`retention.bytes`, so they currently use the
broker's default (`log.retention.hours=168`, i.e. 7 days, per the image's
default `server.properties`). Recommended eventual policy, not yet
applied:

- High-volume, ephemeral topics (`driver.location.received.v1`,
  `driver.location.validated.v1`, `trip.location.updated.v1`): short
  retention (hours to a couple of days) — nothing durably depends on
  replaying GPS history from Kafka itself; Postgres sampling is the durable
  record.
- Business lifecycle topics (`ride.*`, `trip.started/completed/cancelled`,
  `payment.*`): longer retention (days to weeks) — useful for replay/debug
  and for late-joining consumers (e.g. an analytics service added later).

## Dead-letter records

**Not applicable yet.** No DLQ topics exist — that's Phase 7
(`docs/events/retry-and-dlq.md`, not written yet). Don't add a retention
policy for something that doesn't exist; revisit then.

## WebSocket presence

**Not applicable yet.** realtime-gateway (Phase 6) doesn't exist. Revisit
when it does — presence data belongs in Redis with a short TTL, similar in
spirit to the "latest location" pattern above.
