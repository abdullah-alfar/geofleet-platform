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
| `-ride-burst-concurrency` | 50 | Max concurrent ride-request creations |

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

Seeded test data (`loadtest-driver-*@test.local` /
`loadtest-customer-*@test.local`) is left in place afterward — this tool
doesn't clean up after itself. Safe to leave for a local dev database;
delete manually or `php artisan migrate:fresh` if you want a clean slate.
