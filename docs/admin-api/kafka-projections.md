# admin-api: Kafka Projection Consumers

How events become rows in `admin_read`. See
[read-models.md](read-models.md) for the schema itself and
[architecture.md](architecture.md) for why this is the only way admin-api
builds its query-side data (never by reading core-api's tables directly).

## Pipeline

```
Kafka (9 live topics)
  -> KafkaConsumerService (src/integrations/kafka)
       parseEnvelope() — validates the envelope shape, throws on garbage
  -> ProjectionDispatcherService (src/projections)
       looks up the handler for envelope.event_type
       one Kysely transaction:
         INSERT INTO admin_consumer_inbox ... ON CONFLICT DO NOTHING
         if 0 rows inserted -> already processed, stop here
         else -> handler.handle(envelope, trx)
  -> one ProjectionHandler per event_type (src/projections/handlers)
       upserts admin_read tables from envelope.data
```

One `Consumer` (group `admin-api`, `ADMIN_API_CONSUMER_GROUP`), one
`consumer.run()` loop, all 9 topics subscribed with `fromBeginning: true`
— on this instance's first-ever run, it backfills from the earliest
retained offset (Kafka retention is 7 days —
`infrastructure/kafka/init-topics.sh`), so a fresh admin-api deployment
gets a real dashboard immediately instead of an empty one that only fills
in as new events happen to arrive. Every subsequent restart resumes from
the committed offset, same as any other consumer group in this platform.

## Which topics, and which are deliberately excluded

```
apps/admin-api/src/integrations/kafka/topics.ts
```

9 live topics: `driver.status.changed.v1`, `driver.location.validated.v1`,
`ride.requested.v1`, `ride.search.started.v1`,
`ride.offer.created/accepted/rejected.v1`, `ride.assigned.v1`,
`ride.unavailable.v1`.

**Not subscribed**: `trip.started/completed/cancelled.v1`,
`payment.requested/completed/failed.v1`. All six are "planned" in
[topic-catalog.md](../events/topic-catalog.md) — no producer exists in
core-api yet. Subscribing to a topic that can never receive a message
would be untested, unverifiable code, the same standard this repo has
applied everywhere else a producer-side gap exists (see
[data-flow.md](../architecture/data-flow.md)'s note on
`trip.location.updated.v1`). `admin_trip_projection` and
`admin_payment_projection` exist (Phase 3) and have handlers ready to be
written, but nothing consumes into them yet — add the topics to
`topics.ts` and write their handlers the same phase core-api's producer
gap closes.

## A real design gap this phase's own research surfaced

Phase 3's schema assumed richer event payloads than actually exist. Two
concrete gaps, found by tracing the real producer code (not by reading
the topic catalog's field-name summaries) before writing a single
handler:

- **`driver.status.changed.v1`'s `data` payload was originally
  `{ driver_id, is_available }` only.** No event carried a driver's name
  or approval status, so `admin_driver_projection.name`/`.status` were
  permanently `NULL`. `.name` still is — no event carries it. `.status`
  isn't anymore: a real gap caught live once admin-api's Phase 6 commands
  (approve/suspend/unsuspend/disable) actually existed to change it —
  those commands updated core-api's real `drivers.status` while this
  projection (the admin panel's own data source) stayed frozen forever,
  because nothing published it *anywhere*. Fixed by extending this
  event's payload with an optional `status` field
  (`DriverCommandController::publishStatusChanged`, core-api) and this
  handler to write it — but only when present, so a plain availability
  toggle (which never includes `status`) doesn't clobber an admin-set
  value back to `NULL`. Verified live: approved a driver, confirmed
  `status` landed in the projection; then toggled that same driver's own
  availability and confirmed `status` survived unchanged. (Migration:
  `20260814100000_relax_projection_required_columns.ts`.)
- **`ride.requested.v1` is a different Kafka topic than
  `ride.search.started.v1`/`ride.assigned.v1`/`ride.unavailable.v1`.**
  Kafka's per-key ordering guarantee is per-topic-partition, not
  cross-topic — so a ride's `customer_id` (only ever carried by
  `ride.requested.v1`) can't be assumed present when one of those other
  three handlers runs first. Every ride-lifecycle handler upserts
  defensively (creates the row if it doesn't exist yet, using only the
  columns its own event actually informs) rather than assuming
  `ride.requested.v1` already ran.

Neither gap was visible from `docs/events/topic-catalog.md` alone — both
came from reading `DriverAvailabilityController.php`,
`RideRequestController.php`, and dispatch-service's
`matching.go`/`offers/service.go` directly.

## Idempotency

Exactly AGENTS.md's inbox invariant, extended to admin-api's own schema:
unique on `(consumer_name, event_id)`, inbox insert and projection
upsert in one transaction, `ON CONFLICT DO NOTHING` makes a duplicate
delivery a no-op that never even reaches the handler. `consumer_name` is
per-handler (e.g. `admin-api.ride-assigned-projection`), not one shared
name for the whole consumer group — matches the granularity every other
inbox-based consumer in this platform already uses.

## Failure handling: best-effort, not retry/DLQ

A message that fails to parse or project is logged and skipped — not
retried, not routed to a `.retry`/`.dlq` topic pair the way
[ADR 0007](../decisions/0007-retry-dlq-strategy.md) built for core-api's
location consumer and dispatch-service's matching consumer. That
machinery exists specifically for consumers where a dropped message means
real, unrecoverable data loss. Every table here is continuously re-upserted
by later events for the same entity — a driver's next GPS ping or status
change corrects any projection a dropped event left stale, the same
"self-healing" classification ADR 0007 already gives dispatch-service's
own location/status consumers. Building retry/DLQ for inherently
rebuildable, derived data would be solving a problem this schema doesn't
have.

## Bugs caught only by live verification

- **`Generated<ColumnType<...>>` nested incorrectly** — Kysely's
  `Generated<S>` expects a *plain* type, not a `ColumnType`; nesting them
  produced a `ColumnType` wrapping a `ColumnType`, which compiled but made
  every `updated_at` write reject a real `Date` with a confusing
  "not assignable" error. Fixed by using `Generated<Date>` directly.
- **Nullable `ColumnType<...> | null` wrapped from the outside** doesn't
  propagate correctly through Kysely's `Insertable`/`Updateable` mapped
  types — `null` needs to live inside the `ColumnType`'s own type
  parameters. Simplified further: since every handler always constructs a
  real `Date`, most nullable timestamp columns don't need `ColumnType` at
  all — a plain `Date | null` field type is sufficient and correct.
- **Snappy-compressed Kafka batches crashed the consumer entirely** —
  both Go producers (`kgo.ProducerBatchCompression(kgo.SnappyCompression())`
  in dispatch-service/location-service) compress with Snappy; `kafkajs`
  only ships gzip support out of the box. The consumer joined its group
  successfully and crashed on its very first fetch. Fixed by registering
  `kafkajs-snappy`'s codec before constructing the `Kafka` client.
- **A stray malformed message from an earlier phase's manual DLQ testing**
  (`{"event_id":"live-verify-test"}`, no envelope at all) was still
  sitting on `ride.requested.v1` from `fromBeginning`'s historical
  replay. `parseEnvelope`'s validation caught it, logged it, and moved on
  — exactly the intended behavior, and a real (if accidental) test of the
  best-effort error handling described above.

None of these four were visible from a `tsc`/build pass alone — three
needed a real migration run or a real consumer connecting to the actual
broker to surface.

## Live verification performed

Full stack running (core-api, location-service, dispatch-service,
admin-api) against real Docker infrastructure:

- **Historical replay**: `fromBeginning: true` against ~7 days of
  accumulated test traffic from earlier phases populated 106 ride rows,
  256 driver rows, 189 offer rows, and 2,751 inbox rows on first
  connection — a working dashboard from data that already existed,
  not a rebuild from scratch.
- **Fresh live traffic**: ran `scripts/loadtest` (5 drivers, 3 customers,
  real GPS pings and ride requests through the actual HTTP APIs) and
  confirmed exact, correct deltas — ride/driver row counts increased by
  precisely the number of new rides/drivers created, with zero processing
  errors.
- **Idempotency on restart**: stopped and restarted admin-api mid-session.
  Ride and driver projection counts were unchanged after the consumer
  rejoined the group and resumed from its committed offset — no
  duplication, no reprocessing of already-settled events.
- **Correctness spot-checks**: confirmed `assigned` rides carry both
  `driver_id` and `customer_id`; confirmed `name`/`status` are `NULL` on
  every driver row (proving the schema fix was necessary and correct, not
  just theoretically justified); confirmed offer rows show real
  `created_at`/`expires_at` timestamps matching dispatch-service's own
  offer TTL.
