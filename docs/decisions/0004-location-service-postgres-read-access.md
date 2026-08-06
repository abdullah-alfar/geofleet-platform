# ADR 0004: location-service reads device/driver/vehicle identity directly from Postgres

## Status
Accepted

## Context
location-service must reject GPS updates from unknown devices and disabled
drivers/vehicles (brief's explicit GPS validation requirements). That
reference data (`driver_devices`, `drivers`, `vehicles`) is owned and
written by core-api in Postgres. Three options were considered:

1. **Synchronous HTTP call to core-api** on every GPS update to check
   device/driver/vehicle status. Rejected: couples the highest-throughput
   ingestion path in the system to Laravel/PHP request handling being up
   and fast, adding latency and a hard runtime dependency exactly where the
   brief asks for the opposite (location-service should stay up and
   responsive even if core-api has problems).
2. **A new Kafka topic** (e.g. `driver.device.registered.v1`) that core-api
   publishes to and location-service consumes to build its own local
   identity cache. Rejected for this phase: it's the architecturally
   "purest" option and worth revisiting, but it means inventing a topic
   outside the given catalog, plus building and keeping correct a
   Kafka-fed local read model — real complexity for a phase whose stated
   goal is "remain locally runnable and understandable... do not
   over-engineer." Revisit if/when device or driver status changes need to
   propagate to other consumers too, not just this lookup.
3. **Direct, read-only Postgres access** via a dedicated least-privilege
   role. Chosen.

## Decision
Create a `location_service` Postgres role
(`apps/core-api/database/migrations/2026_08_06_150000_create_location_service_role.php`)
granted `SELECT` on exactly `driver_devices`, `drivers`, `vehicles` — no
other tables, no write access anywhere. location-service connects with
this role and wraps lookups in a 30-second in-process TTL cache
(`internal/devicecache`) so the hot path only hits Postgres on a cache
miss.

## Consequences
- This is a deliberate, narrow exception to "services only communicate via
  Kafka" (ADR 0001) — acceptable because it's a read-only reference-data
  lookup, not a domain event, and the brief itself calls for
  "PostgreSQL least-privilege roles" as a security requirement this
  satisfies directly.
- Device/driver/vehicle status can be stale in location-service for up to
  the cache TTL (30s default) after a change in core-api (e.g. an admin
  suspends a driver). Acceptable for GPS ingestion — the consequence of
  staleness is "one more GPS update accepted from a driver whose status
  just changed," not a safety or financial issue like accepting a ride.
- If a future phase needs driver/device status changes to propagate to
  *other* consumers as well (not just this lookup), that's the trigger to
  revisit option 2 (a real Kafka-fed identity stream) rather than adding
  more ad hoc Postgres access from more services.
- core-api owns all writes to these tables; location-service's role
  physically cannot write to them, so there's no risk of the two services'
  view of this data diverging due to conflicting writes.
