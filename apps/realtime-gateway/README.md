# realtime-gateway

Go 1.26.3 service. Pushes ride-lifecycle events to drivers and customers
over WebSocket instead of leaving them to poll: a new ride offer to the
offered driver, ride outcome (assigned/unavailable) and the assigned
driver's live location to the customer. Consume-only — publishes no Kafka
topic of its own — and holds no domain state beyond two small TTL-bounded
Redis correlation mappings. Doesn't touch trips or payments — that's
`apps/core-api`.

## Structure

```
cmd/realtime-gateway/main.go   Wiring + graceful shutdown
internal/
  config/          Environment-based configuration
  types/           Kafka payload shapes this service decodes
  auth/            Postgres-backed WebSocket auth (driver device-token, customer Sanctum token)
  hub/              Local connection registry + Redis Pub/Sub fan-out (see ADR 0006)
  relaystate/       Two TTL-bounded Redis mappings: ride->customer, driver->assignment
  relay/            Kafka handlers: decode an event, publish it to the hub
  redisconn/        Shared Redis client
  kafka/            franz-go consumer wrapper + event envelope
  httpapi/          WS upgrade endpoints, health/readiness
  metrics/          Prometheus metrics (own registry)
  logging/          Structured (JSON) logger
```

## Authentication

No new auth mechanism. Drivers authenticate with the same
`Authorization: Bearer <device_token>` credential apps/location-service and
apps/dispatch-service use. Customers authenticate with their existing
core-api Sanctum bearer token (`{id}|{plaintext}`), verified the same way
Sanctum's own `PersonalAccessToken::findToken()` does. Browsers can't set
custom headers on a WebSocket upgrade request, so both endpoints also
accept the token as `?token=` — same credential, just relocated.

See [docs/decisions/0006-realtime-gateway-fanout.md](../../docs/decisions/0006-realtime-gateway-fanout.md)
for the `realtime_gateway` Postgres role's exact (narrow, read-only) grants.

## Multi-instance fan-out (`internal/hub`)

Kafka consumption is partitioned across however many realtime-gateway
instances are running, same as every other consumer group in this
platform — any one instance only sees a subset of events. Delivery to the
right browser/app connection still works regardless of which instance
handled a given Kafka record: whichever instance did, publishes the
message to a Redis Pub/Sub channel (`rt:driver:{uuid}` /
`rt:customer:{uuid}`); every instance is subscribed to `rt:*` and forwards
to a local WebSocket connection only if it's actually holding one. See
ADR 0006 for why this is Redis Pub/Sub and not N-way Kafka replication.

## Two correlation mappings (`internal/relaystate`)

- `ride_request_id -> customer_id`, set from `ride.requested.v1` (the one
  event in this flow that carries both) — read back to route
  `ride.unavailable.v1`, which deliberately doesn't carry `customer_id`
  (dispatch-service's own PII scope boundary, see the topic-catalog note).
  TTL bounded by the matching window, `RIDE_CORRELATION_TTL`.
- `driver_id -> (ride_request_id, customer_id)`, set from `ride.assigned.v1`
  — read back to relay that driver's subsequent
  `driver.location.validated.v1` updates to the right customer. TTL
  bounded (`DRIVER_ASSIGNMENT_TTL`) rather than cleared on trip completion,
  because no trip-completion event exists yet — see ADR 0006.

## Kafka

Consumes `ride.requested.v1`, `ride.offer.created.v1`, `ride.assigned.v1`,
`ride.unavailable.v1`, and `driver.location.validated.v1` under one
consumer group. Publishes nothing — see
[docs/events/topic-catalog.md](../../docs/events/topic-catalog.md).

## Running locally

Requires the Phase 1 infrastructure up, core-api's migrations applied
(including the `realtime_gateway` role migration), and dispatch-service
running so there are ride-lifecycle events to relay.

```bash
cd apps/realtime-gateway
cp .env.example .env
go run ./cmd/realtime-gateway
```

`.env` loads automatically via `godotenv` at startup (see `cmd/realtime-gateway/main.go`) — no `export` step needed.

## Manual verification

```bash
curl http://localhost:8083/healthz
curl http://localhost:8083/readyz
curl http://localhost:8083/metrics

# As an authenticated driver device (device_token from
# POST /api/v1/driver/devices against core-api) or customer
# (token from POST /api/v1/auth/login), any WebSocket client:
wscat -c "ws://localhost:8083/v1/ws/driver?token=$DEVICE_TOKEN"
wscat -c "ws://localhost:8083/v1/ws/customer?token=$CUSTOMER_TOKEN"
```

## Tests

```bash
go test ./...
```
