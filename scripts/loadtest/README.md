# loadtest

A lightweight, dependency-free Go tool that generates real traffic against
the running local stack (no mocking) and reports latency/throughput by
diffing each service's own Prometheus `/metrics` before and after — see
[docs/architecture/scalability.md](../../docs/architecture/scalability.md)
for how to interpret the numbers it prints, and
[ADR 0008](../../docs/decisions/0008-load-testing-approach.md) for why it's
built this way instead of pulling in k6/Locust/Gatling.

## Prerequisites

Running: Phase 1 infrastructure, core-api (`php artisan serve`), a way to
publish the outbox (this tool runs its own `outbox:publish` pump during
the ride-request phase — no separate terminal needed for that specifically,
but any other outbox loop you already have running is harmless alongside
it), location-service, and dispatch-service. realtime-gateway is optional
— its metrics are skipped if unreachable.

## Usage

```bash
cd scripts/loadtest
go run . -drivers=50 -customers=20 -gps-duration=30s
```

Flags (all optional, see `go run . -h` for the full list and defaults):

| Flag | Default | Meaning |
|---|---|---|
| `-drivers` | 50 | Synthetic drivers seeded and simulated |
| `-customers` | 20 | Synthetic customers, each creating one ride request |
| `-gps-interval` | 4s | Average time between one driver's GPS pings |
| `-gps-duration` | 30s | How long the GPS load phase runs |
| `-seed-concurrency` | 20 | Max concurrent registration requests |
| `-ride-burst-concurrency` | 50 | Max concurrent ride-request creations (also used as the offer-accept phase's concurrency) |
| `-accept-offers` | true | Have each matched driver poll dispatch-service for and accept its offer after the burst |
| `-watch` | 0 (off) | After everything else, keep sending driver GPS pings for this long so the admin dashboard's live map/counters stay populated while you look at them |

## What it does

1. Registers `-drivers` real drivers (with a vehicle + device each) and
   `-customers` real customers via core-api's actual HTTP API, scattered
   within ~1km of a base point (Amman by default).
2. Bulk-activates the seeded drivers directly in Postgres (via
   `docker compose exec postgres psql`) — the same workaround this repo's
   own manual verification always uses, since there's no admin-approval
   endpoint yet (see `contracts/postman/README.md`'s documented gap).
3. Every driver sends GPS pings to location-service for `-gps-duration`.
4. Every customer creates one ride request, as close to simultaneously as
   `-ride-burst-concurrency` allows, exercising dispatch-service's
   candidate search / ranking / offer-creation path under a burst.
5. Prints a report built entirely from each service's own
   already-instrumented Prometheus metrics (histograms included) —
   scraped once before step 3 and once after step 4 finishes draining.
6. If `-accept-offers` (default on): every driver polls dispatch-service
   for its own pending offer (up to 15s, matching `OFFER_TTL`) and accepts
   it — mirrors `scripts/api-test/10-check-offers.sh` +
   `11-accept-offer.sh`, run concurrently across the whole fleet. This is
   what actually turns a matched ride request into an assigned ride and
   flips the driver to unavailable in dispatch-service's Redis index —
   real state for the admin dashboard to show, not just idle pins. Not
   every driver gets an offer (matching is probabilistic — see
   `rides.go`'s doc comment), so some `noOffer` count is expected.
7. If `-watch` is set: keeps pinging GPS for that long afterward, since
   admin-api's live map treats a position as stale after 60s
   (`STALE_LOCATION_AGE_MS`) — without this, drivers vanish from the map
   by the time you've switched over to look at it.

Seeded test data (`loadtest-driver-*@test.local` /
`loadtest-customer-*@test.local`) is left in place afterward — this tool
doesn't clean up after itself. Safe to leave for a local dev database;
delete manually or `php artisan migrate:fresh` if you want a clean slate.

## Demo: seeing it live in admin-web's dashboard/map

To generate visible activity for `apps/admin-web`'s dashboard and
realtime page (`/realtime`, region `amman` by default) rather than just
measure throughput:

```bash
cd scripts/loadtest
go run . -drivers=100 -customers=100 -gps-duration=20s -watch=5m
```

Log into admin-web, open `/realtime`, and watch the driver map/counters
update for the next 5 minutes while the tool keeps GPS pings flowing —
long enough to switch windows and look. The dashboard's summary page
picks up the new drivers/rides immediately (it reads Postgres directly,
no freshness window); the realtime map/counters need at least one GPS
ping to have landed (a few seconds after the tool starts) and stay live
only as long as `-watch` keeps pinging.
