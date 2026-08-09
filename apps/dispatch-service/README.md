# dispatch-service

Go 1.26.3 service. Matches ride requests to nearby available drivers,
manages the ride-offer lifecycle (create, expire, accept, reject), and
performs the atomic ride-acceptance transition that guarantees exactly one
driver wins a given ride. Does not touch trips or payments — that's
`apps/core-api`.

## Structure

```
cmd/dispatch-service/main.go   Wiring + graceful shutdown
internal/
  config/          Environment-based configuration
  types/           Shared event/domain types
  geohash/          Pure-Go geo-cell indexing (see docs/decisions/0005)
  driverindex/      Redis: available-driver index by geohash cell
  indexconsumers/   Kafka handlers feeding driverindex (location + status)
  driverprofile/    Read-only Postgres lookups (drivers/vehicles/devices), TTL cached
  ttlcache/         Generic short-TTL cache used by driverprofile
  ranking/          Pluggable Ranker interface + default weighted implementation
  matching/         The core search -> rank -> offer-or-unavailable cycle
  offerstore/       Write-scoped Postgres: ride_offers + the atomic accept transaction
  offers/           Accept/reject business logic + event publishing
  expiry/           Background sweep that expires stale offers and re-triggers matching
  kafka/            franz-go producer/consumer wrappers
  httpapi/          HTTP server: accept/reject/list-pending endpoints, health/readiness
  metrics/          Prometheus metrics (own registry)
  logging/          Structured (JSON) logger
```

## Device authentication

The accept/reject/list-pending HTTP endpoints authenticate with the same
`Authorization: Bearer <device_token>` credential apps/location-service
uses — no second auth mechanism was invented. See
[docs/decisions/0005-geohash-and-dispatch-db-access.md](../../docs/decisions/0005-geohash-and-dispatch-db-access.md).

## The matching cycle (`internal/matching`)

One function, `Matcher.RunCycle`, handles all three triggers:

1. A fresh `ride.requested.v1` event.
2. An offer expiring (`internal/expiry`'s background sweep).
3. A driver explicitly rejecting an offer (`internal/offers`).

Each call re-reads the ride request's current status from Postgres before
doing anything — this single guard is also how Kafka redelivery and
"customer cancelled during matching" are both handled: neither is
special-cased, they just fall into "status is no longer searching/offered,
no-op."

Steps: resolve the ride request -> find candidates (geohash cell + 8
neighbors, filtered by staleness/availability/vehicle-type/already-offered)
-> rank -> create an offer for the top candidate, or mark the ride
`unavailable` if none are eligible or the attempt cap is reached.

## Concurrency: preventing double-acceptance

`internal/offerstore.Store.AcceptOffer` is the brief's mandated pattern:
two conditional `UPDATE`s (claim the offer, then claim the ride) in one
transaction. If either affects zero rows, the whole thing rolls back — an
offer can never end up "accepted" while its ride went to someone else, no
matter how concurrent accept attempts interleave.

## Kafka

Consumes `driver.location.validated.v1`, `driver.status.changed.v1`, and
`ride.requested.v1` under one consumer group. Publishes
`ride.search.started.v1`, `ride.offer.created.v1`,
`ride.offer.accepted.v1`, `ride.offer.rejected.v1`, `ride.assigned.v1`, and
`ride.unavailable.v1` — see
[docs/events/topic-catalog.md](../../docs/events/topic-catalog.md) for the
full producer/consumer map and why there's no `ride.offer.expired.v1` or
`ride.cancelled.v1` topic.

## Running locally

Requires the Phase 1 infrastructure up, core-api's migrations applied
(including the `dispatch_service` role migration), and ideally
location-service running too (so there's real driver location data to
match against).

```bash
cd apps/dispatch-service
cp .env.example .env
export $(grep -v '^#' .env | xargs)
go run ./cmd/dispatch-service
```

## Manual verification

```bash
curl http://localhost:8082/healthz
curl http://localhost:8082/readyz
curl http://localhost:8082/metrics

# As an authenticated driver device (device_token from
# POST /api/v1/driver/devices against core-api):
curl http://localhost:8082/v1/ride-offers/pending -H "Authorization: Bearer $DEVICE_TOKEN"
curl -X POST http://localhost:8082/v1/ride-offers/$OFFER_ID/accept -H "Authorization: Bearer $DEVICE_TOKEN"
curl -X POST http://localhost:8082/v1/ride-offers/$OFFER_ID/reject -H "Authorization: Bearer $DEVICE_TOKEN"
```

## Tests

```bash
go test ./...
```
