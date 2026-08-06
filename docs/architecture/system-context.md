# System Context

This is a C4-style *system context* view: the platform as a single black
box, its human actors, and the external systems it depends on. Internal
service boundaries (core-api, location-service, dispatch-service,
realtime-gateway) are documented separately in
`docs/architecture/container-diagram.md` once those services exist
(Phase 2+) — showing them here would be speculative.

## Actors and external systems

- **Customer** — books rides via a mobile app, tracks driver location and
  trip status in real time, pays for trips.
- **Driver** — receives ride offers, accepts/rejects them, sends GPS
  updates continuously while online, completes trips.
- **Admin / Operator** — manages business configuration, views audit logs,
  operates the platform via an admin dashboard (owned by core-api).
- **Payment provider** (external, out of scope for MVP implementation but
  modeled in the domain) — settles trip payments.

## Diagram

```mermaid
C4Context
    title Ride-Hailing Platform — System Context

    Person(customer, "Customer", "Requests rides, tracks trips, pays")
    Person(driver, "Driver", "Sends GPS, accepts offers, drives trips")
    Person(admin, "Admin / Operator", "Configures platform, reviews audits")

    System(platform, "Ride-Hailing Platform", "Matches drivers to riders, tracks trips in real time")

    System_Ext(paymentProvider, "Payment Provider", "Settles trip payments")

    Rel(customer, platform, "Requests rides, subscribes to trip updates", "HTTPS / WebSocket")
    Rel(driver, platform, "Sends GPS updates, accepts/rejects offers", "HTTPS / WebSocket")
    Rel(admin, platform, "Manages business config, views audits", "HTTPS")
    Rel(platform, paymentProvider, "Charges / refunds", "HTTPS")
```

## Regional framing

The platform is designed to eventually route trip-related traffic by
`region_id` (e.g. `amman`, `irbid`, `aqaba`) — see the brief's "Regional
Architecture" section. For local development and through the first several
phases, a single region (`amman`, see `.env.example`) is used everywhere.
`region_id` is still carried on relevant records and events from day one
(Phase 2 schema, event envelope) so multi-region routing is additive later
rather than a schema migration.

## What this document intentionally excludes

- Internal service boundaries and their interactions (container diagram,
  added when those services exist).
- Data flow through Kafka topics (data-flow.md, added alongside the outbox
  publisher in Phase 2).
- Capacity/scalability numbers (scalability.md, added when there's a
  concrete implementation to size against).

These are deferred, not forgotten — see the phased plan in the repo root
`README.md`.
