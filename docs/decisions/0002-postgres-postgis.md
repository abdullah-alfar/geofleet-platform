# ADR 0002: Use PostgreSQL with PostGIS as the primary datastore

## Status
Accepted

## Context
The platform needs a durable system of record for business entities (users,
drivers, vehicles, rides, trips, payments) with strong consistency
guarantees (atomic ride acceptance, transactional outbox), plus native
spatial querying for driver search radius, nearest-driver ranking, and trip
route storage.

Alternatives considered:
- **MySQL** — lacks a spatial extension as mature as PostGIS; JSON/geo
  support is weaker for geography-typed distance queries.
- **A dedicated geo database (e.g. MongoDB with geospatial indexes)** —
  would split the system of record across two databases, complicating the
  transactional outbox (which depends on writing the domain row and the
  outbox row in the same ACID transaction) and general relational
  integrity (foreign keys, check constraints) that the business schema
  needs.
- **PostgreSQL + PostGIS** — one transactional store for both relational
  business data and spatial data, `geography(Point, 4326)` types with
  accurate meter-based distance via GiST indexes, and declarative
  partitioning support for high-volume, time-ordered tables (GPS samples,
  audit logs).

## Decision
Use PostgreSQL as the single primary datastore, with the PostGIS extension
enabled (`infrastructure/postgres/init/001-extensions.sql`). Use
`geography(Point, 4326)` for real-world columns needing meter-accurate
distance (driver locations, pickup/drop-off points, route samples).
PostGIS point construction takes `(longitude, latitude)` order — the
inverse of how coordinates are usually spoken/written — and every place
that constructs a point must follow this convention explicitly and
document it inline.

## Consequences
- A single transactional boundary covers domain writes and outbox writes
  (see the transactional outbox pattern in the main brief), avoiding
  distributed transactions across two databases.
- PostgreSQL is NOT used to store every raw GPS ping — that would produce
  roughly 500 GB/day at full projected scale (see capacity notes in
  `docs/architecture/scalability.md`, added in a later phase). Only
  sampled/simplified trip routes and business-state transitions are
  durably stored; raw GPS lives briefly in Kafka and as the latest value in
  Redis.
- High-volume, time-ordered tables (GPS route samples, audit logs) are
  designed for PostgreSQL declarative partitioning from the start, even
  though local dev only needs one partition — retrofitting partitioning
  onto a large existing table is disruptive, so the schema is written
  partition-ready in Phase 2.
- Longitude/latitude ordering mistakes are a known, easy-to-make class of
  bug with PostGIS; this is called out explicitly here so it's caught in
  review rather than discovered via wrong-hemisphere data.
