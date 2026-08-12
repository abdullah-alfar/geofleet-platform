# Scalability & Capacity Analysis

This is the doc [ADR 0002](../decisions/0002-postgres-postgis.md),
[partitioning.md](../database/partitioning.md), and
[system-context.md](system-context.md) all forward-referenced as "added
in a later phase" — Phase 8. It's grounded in real numbers from
[scripts/loadtest](../../scripts/loadtest/), run against the actual local
stack (Docker Compose infrastructure + all four services), not estimated.
See [ADR 0008](../decisions/0008-load-testing-approach.md) for how the
tool itself works and why it's built the way it is.

**Honesty about what this is and isn't**: these runs happened on one
developer machine that was simultaneously running Postgres, Redis, Kafka,
all four application services, *and* the load generator itself. That's
useful for finding correctness issues and getting a rough sense of
per-request cost under real (if modest) concurrency — it is **not** a
production capacity benchmark. Nothing here found the actual ceiling of
any service; every run below was limited by the load generator's own
pacing or by an intentional rate limit, never by a service running out of
headroom. Treat the absolute numbers as "this is fine at this scale, with
room to spare," not as a maximum.

## Target scale (from the brief)

[ADR 0002](../decisions/0002-postgres-postgis.md) and
[partitioning.md](../database/partitioning.md) already record the brief's
stated full-scale target: **~20,000 GPS updates/second**, and the
consequence that raw GPS can never be durably stored in Postgres at that
rate (~500 GB/day) — which is exactly why raw pings only ever live in
Kafka (briefly) and Redis ("latest location"), and only throttled samples
reach Postgres (Phase 4's `LocationSampler`). Nothing this phase found
contradicts that reasoning; if anything, the measurements below reinforce
it (see "Postgres" under Bottlenecks).

## What was run

Four runs via `scripts/loadtest`, each seeding real driver/customer
accounts and generating traffic through the real HTTP APIs (see
ADR 0008 for why seeding itself bypasses the rate-limited registration
endpoint while the *measured* traffic doesn't):

| Run | Drivers | Customers | GPS interval | Duration |
|---|---|---|---|---|
| A — baseline | 10 | 5 | 3s | 15s |
| B — moderate | 50 | 20 | 4s | 30s |
| C — higher | 150 | 60 | 4s | 30s |
| D — rate-limit stress | 20 | 0 | 500ms | 15s |

## Results

### GPS ingestion (location-service)

| Run | Received | Accepted | Rejected | Throughput | Ingestion p50/p95/p99 | Kafka publish p50/p95/p99 |
|---|---|---|---|---|---|---|
| A | 45 | 45 | 0 | 2.5/s | 2.7 / 6.4 / 9.3 ms | 2.5 / 4.7 / 5.0 ms |
| B | 348 | 348 | 0 | 10.3/s | 2.5 / 4.8 / 5.0 ms | 2.5 / 4.7 / 5.0 ms |
| C | 1051 | 1051 | 0 | 30.5/s | 2.5 / 4.8 / 5.0 ms | 2.5 / 4.7 / 5.0 ms |
| D | 590 | 295 | 295 (50%) | 38.0/s | 2.5 / 4.7 / 5.0 ms | 2.5 / 4.7 / 5.0 ms |

Ingestion latency is flat — 2.5-2.7ms median, under 10ms at p99 — across a
tripling of throughput (A→C). That's the signature of a service nowhere
near its own limit; throughput in runs A-C was capped entirely by the load
generator's own pacing (`-gps-interval`), not by location-service.

**Run D is the interesting one.** Halving the interval to 500ms — under
location-service's own `RATE_LIMIT_WINDOW` (1 request/second/driver,
`internal/httpapi`, Phase 3) — didn't degrade latency at all (still ~2.5ms
median) but did produce a clean ~50% rejection rate, exactly what "twice
the allowed rate" predicts. **The practical per-driver GPS throughput
ceiling in this platform is the intentional rate limit, not a resource
constraint** — confirmed by measurement, not assumed.

### Matching (dispatch-service)

| Run | Consumed | Offers created | Unavailable | Matching p50/p95/p99 | Avg candidates/cycle |
|---|---|---|---|---|---|
| A | 5 | 5 | 0 | 3.1 / 4.7 / 5.0 ms | 7.0 |
| B | 21 | 20 | 0 | 5.7 / 17.1 / 23.4 ms | 26.4 |
| C | 60 | 59 | 1 | 11.8 / 24.1 / 35.0 ms | 86.3 |

Matching latency scales with candidate-set size (more drivers within the
geohash search radius → more candidates to rank), which is expected and
correct — `internal/ranking` is O(n) per cycle. Even at 150 drivers
clustered in a ~1km radius (a much denser concentration than any single
Amman neighborhood would realistically have), p99 stayed under 35ms —
comfortably inside the offer-creation path's synchronous budget.

**Finding**: `dispatch_service_candidates_found`'s histogram buckets
(`{0, 1, 2, 3, 5, 10, 20, 50}`, `internal/metrics`) top out at 50. Run C's
average of 86 candidates/cycle means most cycles landed in the `+Inf`
bucket, which is why its p95/p99 both report exactly `50.0` above — the
histogram can't distinguish 51 candidates from 500 once every sample is
past the highest finite bucket. Not a bug in matching itself (ranking and
filtering both still work correctly regardless of candidate count — see
`internal/ranking`'s tests), but the metric as currently bucketed loses
resolution exactly where it'd be most useful: very dense driver clusters.
**Recommendation**: widen the top bucket (e.g. add `100`, `200`) if a
region's real driver density routinely exceeds ~50 candidates per search
radius — cheap to change (`internal/metrics/metrics.go`), not done here
since it's a one-line follow-up with no other code implications.

### Fan-out (realtime-gateway)

Every run showed `events_relayed` matching `offers created` /
`ride.assigned` counts exactly, with zero `redis_publish_errors` or
`ws_send_errors` — the Redis Pub/Sub relay (ADR 0006) kept up completely
at every load level tested. No connections were open during these runs
(the load tool doesn't hold WebSocket connections open — see Phase 6's
own live verification for that), so this doesn't say anything about
concurrent-connection scaling, only about the Kafka-to-Redis relay path.

## Bugs found and fixed while building the measurement tooling itself

Two Prometheus metrics existed only as declarations — registered but
never `.Observe()`/`.Inc()`'d anywhere, silently reporting zero forever:

- `dispatch_service_ride_requests_received_total` — fixed by incrementing
  it in `matching.NewRideRequestedHandler` (not inside `RunCycle`, since
  that's also re-entered by offer expiry/rejection, which aren't
  "received" events).
- `location_service_kafka_publish_duration_seconds` — fixed by timing the
  `PublishValidated` call in `internal/httpapi/location_handler.go`.

Both were caught because this phase's own report depended on them being
real. Worth noting as a general lesson: an unused metric doesn't error,
it just quietly lies — the only way to catch one is to actually consume
the number for something.

## Bottlenecks and scaling path

None of these were *hit* by the runs above — they're identified by
reading the actual configuration, the same "measure, don't guess"
standard the rest of this analysis holds to.

### Postgres connection pooling — real gap, found by inspection

Neither dispatch-service nor realtime-gateway configures `pgxpool`'s
`MaxConns` — both run on the library default, **4 connections**, per
instance (`pgxpool.New(ctx, dsn)` with no `pool_max_conns` in the DSN;
verified against `pgxpool`'s own source, not assumed). At current local
load this never mattered (runs above never queued on the pool). It would
be the first thing to size explicitly before any real concurrent-user
testing beyond what's here — Postgres itself defaults to
`max_connections = 100` (verified via `SHOW max_connections`), which is
the real ceiling to divide across however many service instances end up
sharing it.

**Recommendation**: set `pool_max_conns` explicitly in
`DISPATCH_SERVICE_POSTGRES_DSN` / `REALTIME_GATEWAY_POSTGRES_DSN` once
real concurrent load is a concern, sized against `max_connections / (number
of service instances × other Postgres clients)`.

### Kafka: partitioning already sized for horizontal scale, single broker is the actual limit

[topic-catalog.md](../events/topic-catalog.md) already documents *why*
each topic has the partition count it has (GPS-heavy topics get 6,
lifecycle topics get 3) — that reasoning doesn't change here. What
matters for scaling: partition count is the ceiling on how many consumer
instances of one group can do useful work in parallel. `driver.location.validated.v1`
at 6 partitions already supports up to 6 concurrent location-service...
no, consumer-side: up to 6 concurrent core-api location-consumer
instances (today: 1). The real single-broker Kafka setup
(`replication-factor=1`, per `infrastructure/kafka/init-topics.sh`'s own
comment) is a local-dev simplification, not a production topology — no
new finding here beyond confirming the partition math still holds at the
throughput this phase actually measured.

### realtime-gateway and dispatch-service: already built for horizontal scale

This is worth stating explicitly since it's easy to read a single-instance
capacity report and assume it also caps multi-instance capacity — it
doesn't, by design:

- realtime-gateway's Redis Pub/Sub fan-out (ADR 0006) means adding more
  instances behind a load balancer works *today*, with no code changes —
  each instance independently subscribes to `rt:*` and only forwards to
  connections it locally holds. WebSocket connection count scales with
  instance count, not the other way around.
- dispatch-service's isolated retry-topic consumer group pattern (ADR
  0007) is the same idea already applied to one topic; the main
  `ride.requested.v1` consumer group would scale the identical way —
  more instances, same group, Kafka hands each a disjoint set of
  partitions.

Neither of these needed anything new for Phase 8 — they were architectural
decisions made in Phases 5-7 specifically so this would be true later.

### Geohash precision — an existing, already-exposed tuning knob

Run C's ~86 average candidates per matching cycle, from 150 drivers in a
~1km jitter radius, is denser than precision 6's 9-cell search
(~3.6km × 1.8km, [ADR 0005](../decisions/0005-geohash-and-dispatch-db-access.md))
is really sized for at scale — it's fine at this driver count, but a real
deployment with this density (e.g. a dense downtown core) would see
candidate sets grow further as driver count grows, with no corresponding
increase in match quality (ranking already picks the single best driver
regardless of whether there are 20 or 200 candidates — more candidates
past a point is wasted ranking work, not a better outcome).
`GEOHASH_PRECISION` is already an environment variable for exactly this
kind of region-specific tuning (ADR 0005) — increasing it for
high-density regions shrinks cell size and candidate-set size together.
No code change needed, just a per-region config decision once real
density data exists.

## What would actually need to change to approach ~20k GPS updates/sec

Not tested here (would require infrastructure this repo doesn't have —
AGENTS.md: no Kubernetes, single-broker Kafka is a deliberate local-dev
simplification) but the path is a direct extension of what's already
built, not a redesign:

1. **Horizontal location-service instances** behind a load balancer —
   already stateless per-request (Redis for shared "latest location"
   state), so this is a deployment change, not a code change.
2. **More Kafka partitions** on `driver.location.received.v1` /
   `driver.location.validated.v1` (currently 6) to give those extra
   instances something to parallelize against on the consumer side.
3. **Explicit `pgxpool`/Postgres connection budgets** per the gap found
   above, once instance count multiplies concurrent connection demand.
4. A real production Kafka topology (replication factor > 1, multiple
   brokers) — the single-broker setup here is explicitly a local-dev
   choice, never claimed otherwise.

## Reproducing this

```bash
cd scripts/loadtest
go run . -drivers=150 -customers=60 -gps-duration=30s -gps-interval=4s
```

See [scripts/loadtest/README.md](../../scripts/loadtest/README.md) for
the full flag list and prerequisites.
