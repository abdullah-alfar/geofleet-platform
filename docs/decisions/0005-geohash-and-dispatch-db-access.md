# ADR 0005: Geohash instead of H3; dispatch-service's write-scoped Postgres access

## Status
Accepted

## Context
Phase 5 needed two decisions the brief left partially open: which
hierarchical geo-cell strategy to use for nearby-driver search (the brief
names H3 but explicitly allows "H3 or an equivalent"), and how
dispatch-service gets the data and write access it needs to perform the
brief's mandated atomic ride-acceptance transition.

### Geo-cell indexing: geohash, not H3

The standard Go binding for H3 (`h3-go`) wraps the H3 C library via cgo.
That means:
- A C toolchain is required at build time.
- The static, distroless Docker build pattern used for location-service
  (Phase 3) — `CGO_ENABLED=0`, `gcr.io/distroless/static-debian12` — stops
  being possible; the runtime image would need libc and would be
  meaningfully larger and slower to build/cross-compile.
- No mature pure-Go H3 reimplementation exists to fall back on.

`github.com/mmcloughlin/geohash` is pure Go, has no build-time
dependencies beyond the Go toolchain, and the algorithm is the same shape
as H3 for this use case: a string prefix identifies a cell, adjacent cells
are cheap to enumerate, and precision (character count for geohash,
resolution for H3) trades cell size against search cost the same way.

**Trade-off accepted**: geohash cells are rectangular and their aspect
ratio alternates as precision increases (odd vs. even character count),
unlike H3's uniform hexagons — so "distance to nearest cell edge" varies
more by direction, and a naive radius search can miss a candidate just
outside a cell corner. This is mitigated, not eliminated, by always
searching the center cell **and its 8 neighbors** (`geohash.Neighbors`),
which is the same idea as an H3 k=1 grid disk. It's also mitigated by the
fact that every candidate found this way is re-scored by an accurate
haversine distance calculation before ranking — the geo-cell search is
only ever a coarse pre-filter, never the actual distance used for ranking
or display.

**Precision chosen: 6** — roughly 1.2km × 0.61km cells. Coarse enough that
9 cells (center + 8 neighbors) cover a realistic urban pickup search
radius without needing a second, wider search pass; fine enough that
`SMEMBERS`/`SUNION` on a cell stays cheap even in a dense urban core.
Revisit if real traffic shows this precision returning too few or too many
candidates for a given region's driver density — this is exactly why
`internal/config.GeohashPrecision` is an environment variable, not a
constant.

**Revisit if**: a future need specifically requires H3 (e.g. interop with
an external system that speaks H3 cell IDs), or a mature pure-Go H3
implementation becomes available.

### dispatch-service's Postgres access

Extends the read-only pattern from
[ADR 0004](0004-location-service-postgres-read-access.md) with real write
access, because the brief's core correctness requirement — preventing two
drivers from accepting the same ride — has to be a conditional UPDATE
executed directly against Postgres. There is no way to get the same
exactly-one-winner guarantee through an event-driven or two-phase
mechanism at this level of simplicity; row-level locking during the
UPDATE is what actually provides it.

The `dispatch_service` role
(`apps/core-api/database/migrations/2026_08_09_100000_create_dispatch_service_role.php`)
is scoped as narrowly as the actual requirement allows:
- `SELECT` on `ride_requests`, `drivers`, `vehicles`, `driver_devices` —
  read-only reference data, plus reusing location-service's exact
  device-token auth pattern for the accept/reject HTTP endpoints rather
  than inventing a second auth mechanism.
- Column-scoped `UPDATE (status, driver_id, accepted_at)` on
  `ride_requests` — cannot touch pickup/dropoff, payment-adjacent fields,
  or anything else on that row.
- Full `SELECT`/`INSERT`/`UPDATE` on `ride_offers` — the one table this
  service owns outright.

No access to `customers`, `payments`, `trips`, `audit_logs`, or anything
core-api alone should be writing.

### Why dispatch-service does NOT get a transactional outbox

core-api's outbox pattern (ADR 0001, AGENTS.md) exists because a single
HTTP request there can involve a multi-step business transaction where the
Postgres write and the "intent to publish" must never diverge.
dispatch-service's Kafka publishes are different in kind: each one follows
a Postgres write whose correctness is *already* fully established by the
conditional UPDATE succeeding (exactly one row affected). The event is a
best-effort notification layered on top, not part of the consistency
boundary — the same reasoning apps/location-service already applies to its
own Kafka publishes (see its `internal/httpapi/location_handler.go`
ordering comment). Introducing a *third* pattern (a Go-native
transactional outbox) for one of three services, for a guarantee the
atomic UPDATE already provides, was judged not worth the added complexity
for this phase. If a future phase finds ride.* event loss is a real
operational problem, this is the place to revisit it.
