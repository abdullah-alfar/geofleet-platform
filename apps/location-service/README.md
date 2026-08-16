# location-service

Go 1.26.3 service. Ingests driver GPS updates over HTTP, validates them
against every rule in the platform brief, publishes valid events to Kafka,
and keeps a live "latest location" per driver in Redis. Does not process
ride/trip/payment data — that's `apps/core-api`.

## Structure

```
cmd/location-service/main.go     Wiring + graceful shutdown
internal/
  config/       Environment-based configuration (no global state)
  gps/          Shared types (Update, Device, LastState, Rejection)
  validation/   The GPS validation pipeline (pure, unit-tested)
  devicestore/  Read-only Postgres lookups (device -> driver -> vehicle)
  devicecache/  Short-TTL in-process cache wrapping devicestore
  redisstore/   Latest-location storage + rate limiting
  kafka/        franz-go publisher (driver.location.{received,validated}.v1)
  httpapi/      HTTP server, auth middleware, handlers, health/readiness
  metrics/      Prometheus metrics (own registry, not the global default)
  logging/      Structured (JSON) logger
```

## Device authentication

Requests carry `Authorization: Bearer <device_token>` — a credential
distinct from a driver's core-api user session (see repo-root AGENTS.md).
The service authenticates it against `driver_devices.token_hash` via a
**least-privilege Postgres role** (`location_service`, `SELECT`-only on
`driver_devices`, `drivers`, `vehicles` — created by core-api's
`2026_08_06_150000_create_location_service_role.php` migration), wrapped in
a 30-second in-process cache so the hot ingestion path only hits Postgres on
a cache miss.

## Validation pipeline (`internal/validation`)

Runs in this order, returning the first failure:

1. Device/driver/vehicle status (all must be `active`)
2. Latitude/longitude range
3. Accuracy (`accuracy_meters` within a configurable ceiling)
4. Timestamp staleness / future-timestamp skew
5. Duplicate/out-of-order sequence number
6. Physically implausible movement (haversine distance / elapsed time vs. a
   max plausible speed — this single check covers both "impossible speed"
   and "impossible geographic jumps" from the brief, since a huge jump in a
   short time *is* a huge implied speed)

Rejections are returned as `422` with a stable machine-readable `reason`
code (also a Prometheus label) — see `internal/gps/types.go` for the full
list.

## Kafka events

| Topic | When | Notes |
|---|---|---|
| `driver.location.received.v1` | After parsing, before validation | Best-effort raw/audit stream — a publish failure here never fails the request. |
| `driver.location.validated.v1` | After all validation passes | The stream other services should consume. A publish failure here **does** fail the request (503) — see `internal/httpapi/location_handler.go` for the full ordering rationale (Kafka publish before the Redis state write, so a failure never leaves Redis "ahead of" what was actually published). |

Both keyed by `driver_id` (per-driver ordering — see
`docs/events/topic-catalog.md`).

## Redis keys

| Key | Purpose | TTL |
|---|---|---|
| `location:latest:{driver_id}` | Last accepted update (position, sequence, accuracy, speed, heading) — both the validation pipeline's "last state" input and the durable "latest location" the brief calls for. | 5 minutes (configurable via `LOCATION_TTL`) — a driver who stops sending updates naturally drops out. |
| `location:ratelimit:{driver_id}` | Fixed-window request counter. | 1 second (configurable via `RATE_LIMIT_WINDOW`). |

Geo-cell (H3) membership is **not** built here — that's dispatch-service's
job (Phase 5), consuming `driver.location.validated.v1` to build its own
index. See the package comment in `internal/redisstore` for why.

## Running locally

Requires the Phase 1 infrastructure up (`docker compose up -d` from the
repo root) and the Phase 2 migrations applied (including the
`location_service` role migration).

```bash
cd apps/location-service
cp .env.example .env
go run ./cmd/location-service
```

`.env` loads automatically via `godotenv` at startup (see `cmd/location-service/main.go`) — no `export` step needed.

## Manual verification

```bash
# Health/readiness
curl http://localhost:8081/healthz
curl http://localhost:8081/readyz

# Metrics
curl http://localhost:8081/metrics

# A GPS update (replace DEVICE_TOKEN/DRIVER_ID/DEVICE_ID with values from
# a real POST /api/v1/driver/devices response against core-api)
curl -X POST http://localhost:8081/v1/locations \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "driver_id": "'"$DRIVER_ID"'",
    "device_id": "'"$DEVICE_ID"'",
    "trip_id": null,
    "sequence": 1,
    "latitude": 31.9539,
    "longitude": 35.9106,
    "accuracy_meters": 8.5,
    "speed_mps": 12.4,
    "heading_degrees": 140.0,
    "recorded_at": "'"$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"'"
  }'
```

## Tests

```bash
go test ./...
```
