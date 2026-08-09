# Topic Catalog

Topics are created explicitly by
[infrastructure/kafka/init-topics.sh](../../infrastructure/kafka/init-topics.sh)
(Phase 1) — Kafka auto-topic-creation is disabled cluster-wide, so a
producer publishing to a topic not listed here will fail rather than
silently create it. See [event-envelope.md](event-envelope.md) for the
message shape every topic uses.

Retry and dead-letter topics are intentionally **not** in this catalog yet
— that's Phase 7 (Reliability), documented in
[retry-and-dlq.md](retry-and-dlq.md) when it exists. Don't add
`.retry`/`.dlq` topics ahead of that phase.

## Status legend

- **live** — a real producer exists today and has been verified end-to-end.
- **planned** — reserved in the catalog (created in Phase 1) but no
  producer/consumer exists yet; will go live in the phase noted.

## Driver location

| Topic | Partitions | Key | Producer | Consumer | Status |
|---|---|---|---|---|---|
| `driver.location.received.v1` | 6 | `driver_id` | location-service | none yet | live (Phase 3) — best-effort raw/audit stream, see [apps/location-service/README.md](../../apps/location-service/README.md) |
| `driver.location.validated.v1` | 6 | `driver_id` | location-service | core-api (`kafka:consume-location-updates`), dispatch-service (planned) | live (Phase 3 producer, Phase 4 consumer) — see [apps/core-api's ConsumeLocationUpdates](../../apps/core-api/app/Console/Commands/ConsumeLocationUpdates.php) |
| `driver.status.changed.v1` | 3 | `driver_id` | core-api (`PATCH /api/v1/driver/availability`) | dispatch-service | live (Phase 2 producer, Phase 5 consumer) |

Why `driver_id` as the key for all three: every update for one driver must
land on the same partition so a single consumer instance sees them in
order — required for the out-of-order/duplicate-sequence detection in
location-service, and for dispatch-service to see a driver's
availability/location changes in a consistent order.

## Ride lifecycle

| Topic | Partitions | Key | Producer | Consumer | Status |
|---|---|---|---|---|---|
| `ride.requested.v1` | 3 | `ride_request_id` | core-api (`POST /api/v1/ride-requests`) | dispatch-service | live (Phase 2 producer, Phase 5 consumer) |
| `ride.search.started.v1` | 3 | `ride_request_id` | dispatch-service | — | live (Phase 5) — published once, on the first matching cycle for a ride request |
| `ride.offer.created.v1` | 3 | `ride_request_id` | dispatch-service | realtime-gateway (planned) | live (Phase 5) producer; consumer lands Phase 6 |
| `ride.offer.accepted.v1` | 3 | `ride_request_id` | dispatch-service | — | live (Phase 5) |
| `ride.offer.rejected.v1` | 3 | `ride_request_id` | dispatch-service | — | live (Phase 5) |
| `ride.assigned.v1` | 3 | `ride_request_id` | dispatch-service | core-api (planned), realtime-gateway (planned) | live (Phase 5) producer; consumers land later |
| `ride.unavailable.v1` | 3 | `ride_request_id` | dispatch-service | core-api (planned), realtime-gateway (planned) | live (Phase 5) producer; consumers land later |

Why `ride_request_id` as the key: all lifecycle events for one ride must be
processed in order by one dispatch-service consumer instance to prevent
race conditions in offer handling (see AGENTS.md's atomic-acceptance
invariant).

Note: there is deliberately no `ride.cancelled.v1` topic. Customer-initiated
cancellation (`POST /api/v1/ride-requests/{id}/cancel`) is a plain
conditional Postgres UPDATE with no accompanying Kafka event — see the
comment in `App\Http\Controllers\Api\V1\RideRequestController::cancel()`
for why that's correct (dispatch-service's atomic acceptance UPDATE already
guards on `status = 'searching'`, so a cancelled request naturally fails to
be assigned without needing a push notification for correctness). A
dedicated topic would only be needed later to *proactively* notify a driver
mid-offer — a Phase 6 realtime-gateway concern, not built ahead of schedule.

Similarly, there is no `ride.offer.expired.v1` topic. An offer timing out
(`internal/expiry`, dispatch-service) re-triggers matching for the next
candidate, which publishes either another `ride.offer.created.v1` or
`ride.unavailable.v1` — that outcome is what other services need to react
to; the expiration itself is an internal implementation detail of the
matching state machine.

dispatch-service's six `ride.*` publishes are direct, synchronous Kafka
produces immediately after the Postgres write that earned them — **not**
routed through a transactional outbox the way `trip.location.updated.v1`
is. See [ADR 0005](../decisions/0005-geohash-and-dispatch-db-access.md)
for why: the conditional `UPDATE` each publish follows already fully
establishes correctness (exactly one row affected), so the event is a
best-effort notification layered on top, not part of the consistency
boundary — the same reasoning location-service applies to its own Kafka
publishes.

## Trip lifecycle

| Topic | Partitions | Key | Producer | Consumer | Status |
|---|---|---|---|---|---|
| `trip.started.v1` | 3 | `trip_id` | core-api (planned) | realtime-gateway | planned |
| `trip.location.updated.v1` | 6 | `trip_id` | core-api (`App\Domain\Location\LocationSampler`, via the transactional outbox) | realtime-gateway (planned) | live (Phase 4) producer; consumer lands Phase 6 |
| `trip.completed.v1` | 3 | `trip_id` | core-api (planned) | realtime-gateway, payments | planned |
| `trip.cancelled.v1` | 3 | `trip_id` | core-api (planned) | realtime-gateway | planned |

`trip.location.updated.v1` is a **derived** event: it's produced by a Kafka
*consumer* (of `driver.location.validated.v1`), not by an HTTP request.
Rather than a direct Kafka publish from within the consumer, it's enqueued
via the same `outbox_events` table and `outbox:publish` command that
handles HTTP-triggered events — so the Postgres write (the trip location
sample + the inbox idempotency record) and the "intent to publish" commit
atomically in one transaction. Its `causation_id` is the triggering
`driver.location.validated.v1` event's `event_id` (see
[event-envelope.md](event-envelope.md)) — the first place in this codebase
that field is actually populated, since every event before this one has
been a root event caused directly by an HTTP request.

## Payments

| Topic | Partitions | Key | Producer | Consumer | Status |
|---|---|---|---|---|---|
| `payment.requested.v1` | 3 | `payment_id` | core-api (planned) | — | planned |
| `payment.completed.v1` | 3 | `payment_id` | payment provider integration (planned) | core-api | planned |
| `payment.failed.v1` | 3 | `payment_id` | payment provider integration (planned) | core-api | planned |

## Notifications

| Topic | Partitions | Key | Producer | Consumer | Status |
|---|---|---|---|---|---|
| `notification.requested.v1` | 3 | none (round-robin) | any service | notification service (not yet designed) | planned |

Unkeyed deliberately: notification volume should spread across partitions
rather than concentrate on whichever recipient happens to be most active.
