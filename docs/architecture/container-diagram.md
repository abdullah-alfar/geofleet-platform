# Container Diagram

This is the C4-style *container* view [system-context.md](system-context.md)
has deferred since Phase 0 ("added when those services exist"): the five
deployable services, the three shared infrastructure containers, and the
protocols/credentials between them. Everything here reflects what's
actually built and running, not a target architecture — see
[data-flow.md](data-flow.md) for how data actually moves through these
containers over Kafka, and [scalability.md](scalability.md) for how each
one behaves under load.

## Diagram

```mermaid
C4Container
    title Ride-Hailing Platform — Container Diagram

    Person(customer, "Customer", "Mobile app")
    Person(driver, "Driver", "Mobile app, sends GPS continuously")
    Person(admin, "Admin / Operator", "Web dashboard, served by admin-api")

    System_Boundary(platform, "Ride-Hailing Platform") {
        Container(coreApi, "core-api", "Laravel 13 / PHP 8.4", "Auth, driver/vehicle/customer profiles, ride requests, trips, payments, admin, transactional outbox publisher. Port 8000.")
        Container(locationService, "location-service", "Go 1.26.3", "Validates and ingests driver GPS updates. Port 8081.")
        Container(dispatchService, "dispatch-service", "Go 1.26.3", "Matches ride requests to nearby drivers; atomic ride-acceptance. Port 8082.")
        Container(realtimeGateway, "realtime-gateway", "Go 1.26.3", "Relays ride-lifecycle events and live driver location to WebSocket clients. Port 8083.")
        Container(adminApi, "admin-api", "NestJS 11 / TypeScript", "Admin BFF: aggregates Kafka-derived read models, forwards commands to core-api's internal API, reads live driver state from Redis. Never writes to core-api's tables directly. Port 3001.")

        ContainerDb(postgres, "Postgres", "PostgreSQL 16 + PostGIS 3.4", "System of record. One database, per-service least-privilege roles. Host port 55432.")
        ContainerDb(redis, "Redis", "Redis 7.4", "Latest-driver-location cache, geo-cell driver index, realtime-gateway Pub/Sub + correlation state, core-api cache/session. Host port 63790.")
        Container(kafka, "Kafka", "Apache Kafka 3.9, KRaft, single broker", "Only inter-service event bus. Auto-topic-creation disabled — see infrastructure/kafka/init-topics.sh. Host port 9094.")
    }

    System_Ext(paymentProvider, "Payment Provider", "Settles trip payments (planned, not yet integrated)")

    Rel(customer, coreApi, "Registers, requests rides, manages profile", "HTTPS")
    Rel(customer, realtimeGateway, "Receives ride outcome + live driver location", "WebSocket")
    Rel(driver, coreApi, "Registers, manages device/vehicle, polls pending offers (fallback)", "HTTPS")
    Rel(driver, locationService, "Sends GPS updates", "HTTPS, Bearer device-token")
    Rel(driver, dispatchService, "Accepts/rejects ride offers", "HTTPS, Bearer device-token")
    Rel(driver, realtimeGateway, "Receives ride offers", "WebSocket, Bearer device-token")
    Rel(admin, adminApi, "Views dashboard, manages drivers/trips/payments, live driver map", "HTTPS, Bearer admin token")

    Rel(coreApi, postgres, "Owns schema; full read/write", "libpq")
    Rel(coreApi, redis, "Cache + session store (framework-level, no domain state)", "Redis protocol")
    Rel(coreApi, kafka, "Publishes via transactional outbox; consumes driver.location.validated.v1", "Kafka protocol")

    Rel(locationService, postgres, "Device/driver/vehicle status lookups (role: location_service, SELECT-only, 30s cache)", "libpq")
    Rel(locationService, redis, "Latest location + per-driver rate limit", "Redis protocol")
    Rel(locationService, kafka, "Publishes driver.location.{received,validated}.v1", "Kafka protocol")

    Rel(dispatchService, postgres, "Ride request/offer read+write (role: dispatch_service, column-scoped)", "libpq")
    Rel(dispatchService, redis, "Geo-cell driver index (geohash), driver profile TTL cache", "Redis protocol")
    Rel(dispatchService, kafka, "Consumes location/status/ride-requested; publishes ride.* lifecycle events", "Kafka protocol")

    Rel(realtimeGateway, postgres, "WebSocket auth only (role: realtime_gateway, read-only)", "libpq")
    Rel(realtimeGateway, redis, "Pub/Sub fan-out (rt:driver:*, rt:customer:*) + TTL correlation state", "Redis protocol")
    Rel(realtimeGateway, kafka, "Consumes ride.* + driver.location.validated.v1; publishes nothing", "Kafka protocol")

    Rel(adminApi, postgres, "Owns the admin_read schema (role: admin_api); reads 3 auth tables in public — never core-api's business tables", "libpq")
    Rel(adminApi, kafka, "Consumes 9 domain-event topics -> admin_read projections", "Kafka protocol")
    Rel(adminApi, redis, "Reads dispatch-service's live driver state, read-only", "Redis protocol")
    Rel(adminApi, coreApi, "Forwards operational commands only: PATCH /internal/v1/*", "HTTPS, shared secret")

    Rel(coreApi, paymentProvider, "Charges / refunds (planned)", "HTTPS")
```

## Containers

| Container | Tech | Port | Owns |
|---|---|---|---|
| [core-api](../../apps/core-api/README.md) | Laravel 13 / PHP 8.4 | 8000 | Auth, customer/driver/vehicle profiles, ride requests, trips, payments, admin, the transactional outbox |
| [location-service](../../apps/location-service/README.md) | Go 1.26.3 | 8081 | GPS ingestion + validation, "latest location" cache |
| [dispatch-service](../../apps/dispatch-service/README.md) | Go 1.26.3 | 8082 | Nearby-driver matching, ride offers, atomic acceptance |
| [realtime-gateway](../../apps/realtime-gateway/README.md) | Go 1.26.3 | 8083 | WebSocket push of ride-lifecycle events + live location |
| [admin-api](../../apps/admin-api/README.md) | NestJS 11 / TypeScript | 3001 | Admin BFF — query aggregation (Kafka projections), command forwarding, live driver map |

None of the three Go services own domain data beyond the narrow Postgres
slice AGENTS.md's least-privilege convention grants them — core-api is the
only container with unrestricted access to its own schema. Every Go
service's exact grant is a per-service ADR: location-service
([0004](../decisions/0004-location-service-postgres-read-access.md)),
dispatch-service ([0005](../decisions/0005-geohash-and-dispatch-db-access.md)),
realtime-gateway ([0006](../decisions/0006-realtime-gateway-fanout.md)).
admin-api is held to a *stricter* rule than any of the three Go
services — it owns its own schema (`admin_read`) outright rather than
getting a narrow grant on core-api's tables, and has no write path to
core-api's business tables at all, not even a single-row conditional
`UPDATE` — see [docs/admin-api/architecture.md](../admin-api/architecture.md)'s
"Critical architecture rule" and [ADR 0009](../decisions/0009-admin-identity.md)/
[ADR 0010](../decisions/0010-internal-service-authentication.md).

## Shared infrastructure

| Container | Used by | For |
|---|---|---|
| Postgres 16 + PostGIS 3.4 | all five services | System of record. One physical database, one role per service (`location_service`, `dispatch_service`, `realtime_gateway`, `admin_api`; core-api connects as the migration-owning role). No service reads or writes another's tables outside its granted role — `admin_api` is the only one that *owns* a whole schema (`admin_read`) rather than getting column-scoped grants on core-api's own tables. |
| Redis 7.4 | all five services | Five unrelated uses sharing one instance: location-service's latest-location/rate-limit keys, dispatch-service's geohash driver index, realtime-gateway's Pub/Sub channels + correlation state, core-api's framework cache/session store (`CACHE_STORE=redis`, `SESSION_DRIVER=redis` — carries no domain data at all, unlike the others), and admin-api's read-only lookups of dispatch-service's own `dispatch:driver:{id}` keys (Phase 7 — never writes, never touches `dispatch:geocell:*`). |
| Kafka 3.9 (KRaft, single broker) | all five services | The only inter-service event bus (AGENTS.md hard invariant — no service calls another's HTTP API for anything on the write path, except the driver-facing accept/reject calls dispatch-service itself serves, and admin-api's command forwarding to core-api's internal API). See [topic-catalog.md](../events/topic-catalog.md) for every topic and [data-flow.md](data-flow.md) for how events actually move end to end. admin-api consumes 9 of them into its own read-model schema; it publishes to none. |

## Authentication credentials by container

Three distinct credentials, reused across services rather than each
service inventing its own (see ADR
[0005](../decisions/0005-geohash-and-dispatch-db-access.md#dispatch-services-postgres-access)/[0006](../decisions/0006-realtime-gateway-fanout.md#reusing-existing-auth-not-inventing-a-third-mechanism)):

- **Driver device token** (`Authorization: Bearer <device_token>`, SHA-256
  hashed, `driver_devices.token_hash`) — issued by core-api
  (`POST /api/v1/driver/devices`), verified independently by
  location-service, dispatch-service, and realtime-gateway, each against
  its own least-privilege Postgres role.
- **Customer/driver Sanctum token** (`{id}|{plaintext}`) — issued by
  core-api (`POST /api/v1/auth/login`), verified by core-api itself for
  its own REST API and by realtime-gateway for the customer WebSocket
  endpoint (replicating Sanctum's own lookup, not calling back into
  core-api).
- **Admin Sanctum token** (`{id}|{plaintext}`, abilities-scoped) — issued
  by the same `POST /api/v1/auth/login` endpoint as customer/driver
  tokens, not a separate session-based mechanism (see
  [ADR 0009](../decisions/0009-admin-identity.md) for why a second
  identity system wasn't built). Verified by admin-api the same way
  realtime-gateway verifies customer/driver tokens — split, hash,
  constant-time compare against Postgres directly, no call back into
  core-api — with abilities read straight off the token row and enforced
  by `PermissionsGuard` (`docs/admin-api/authentication.md`/`permissions.md`).

No service calls another service's HTTP API to authenticate a request —
every credential is verified locally against Postgres, which is why
realtime-gateway's and admin-api's Postgres roles both exist despite
neither service holding much (or any, for realtime-gateway) other domain
state. The one exception on the *command* path: admin-api's
`internal/v1/*` calls to core-api are authenticated by a shared secret,
not a Postgres-verified token — see
[ADR 0010](../decisions/0010-internal-service-authentication.md) for why
that boundary is different in kind from every other credential here (it
authenticates *a service*, not a human).

## What this diagram intentionally excludes

- Internal package/module structure within each container — see each
  service's own README (`## Structure`) for that.
- Deployment topology (how many instances, load balancer, Kubernetes,
  etc.) — this repo runs everything as a single instance per service
  locally (AGENTS.md: no Kubernetes manifests, no autoscaling config in
  scope). [scalability.md](scalability.md)'s "path to ~20k GPS
  updates/sec" section describes what multi-instance deployment of these
  same containers would look like, without prescribing an orchestrator.
- The payment provider integration — reserved in the schema and topic
  catalog (`payment.*.v1`) but never built (see
  [topic-catalog.md](../events/topic-catalog.md)'s Payments section);
  shown here only as the one planned external dependency the brief
  describes.
