# admin-api: Read Models

The `admin_read` Postgres schema, owned outright by the `admin_api` role,
and how it's built/migrated. See
[docs/decisions/0009-admin-identity.md](../decisions/0009-admin-identity.md)
for why this role (not a second one) owns it, and
[architecture.md](architecture.md) for why this schema exists at all
(the query/command separation the whole service is built around).

## Schema ownership

```
apps/core-api/database/migrations/2026_08_13_100000_grant_admin_read_schema_to_admin_api.php
  -> CREATE SCHEMA admin_read
  -> ALTER SCHEMA admin_read OWNER TO admin_api
```

core-api provisions the empty schema and hands over ownership — it never
defines what's inside. Everything from that point on is admin-api's own
concern, migrated independently:

```
apps/admin-api/src/database/migrations/*.ts
  -> npm run migrate -- up
```

One Postgres role (`admin_api`), one connection pool
(`src/integrations/postgres`), two schemas: `public` (three narrow,
column-scoped grants for Phase 2 authentication —
personal_access_tokens/users/admins) and `admin_read` (full ownership,
Phase 3+). The pool's `search_path` is `admin_read, public`, so neither
schema needs an explicit prefix in day-to-day queries.

## Why Kysely

Chosen in Phase 0, installed here in Phase 3 alongside the first real
schema (see [architecture.md](architecture.md)'s tech-choices table).
Recap: this repo's database philosophy — raw, reviewed SQL migrations,
explicit index rationale, no ORM-driven schema sync — fits a typed query
builder with hand-written migrations better than an entity/decorator-
driven ORM. Kysely migrations are plain `up`/`down` TypeScript functions
(`src/database/migrations/*.ts`), run via a standalone CLI
(`npm run migrate -- up|down|status`, `src/database/migrate.ts`) that's
deliberately outside Nest's DI — it doesn't start Kafka/HTTP listeners to
apply a schema change, the same way `php artisan migrate` doesn't boot
core-api's full HTTP stack either.

One thing this project's Postgres-role setup requires that a default
Kysely config doesn't handle automatically: Kysely's own migration-
bookkeeping tables (`kysely_migration`, `kysely_migration_lock`) default
to the `public` schema, where `admin_api` has no `CREATE` grant. Set
explicitly via `migrationTableSchema: 'admin_read'` — caught by actually
running the migration CLI against the real role, not by reading Kysely's
docs (the first attempt failed with "permission denied for schema
public").

## Tables

| Table | Fed by (Phase 4) | Status |
|---|---|---|
| `admin_consumer_inbox` | n/a — used by every projection consumer for idempotency | infrastructure, not a projection itself |
| `admin_driver_projection` | `driver.status.changed.v1`, `driver.location.validated.v1` | topics live |
| `admin_ride_projection` | `ride.requested.v1`, `ride.search.started.v1`, `ride.offer.created.v1`, `ride.assigned.v1`, `ride.unavailable.v1` | topics live |
| `admin_ride_offer_projection` | `ride.offer.created/accepted/rejected.v1` | topics live |
| `admin_trip_projection` | `trip.started/completed/cancelled.v1` | **topics planned, no producer yet** — see below |
| `admin_payment_projection` | `payment.requested/completed/failed.v1` | **topics planned, no producer yet** — see below |
| `admin_region_metrics` | derived/aggregated, not a direct 1:1 topic mapping — design TBD in Phase 4 | n/a |

`driver_id`/`ride_request_id`/`trip_id`/`payment_id`/`offer_id` are each
the source event's own public uuid, used directly as the primary key —
every projection is upserted by that id, never auto-incremented.

**Two tables will stay empty after Phase 4, not because of a bug but
because their source topics have no producer yet**:
`admin_trip_projection` needs `trip.*.v1`, which needs core-api to
consume `ride.assigned.v1` and create `trips` rows — a gap
[docs/architecture/data-flow.md](../architecture/data-flow.md) already
documents. `admin_payment_projection` needs `payment.*.v1`, entirely
unbuilt in core-api. Building the tables now (rather than waiting) means
Phase 4's consumers and Phase 5's queries can be written and tested
against a real schema today; they'll just have no rows until those
producer-side gaps close, the same honest tradeoff `trip_location_samples`
already lives with in core-api's own schema.

## Indexes

Every index below is justified by a specific query, per this project's
own rule (AGENTS.md: "before adding an index, explain the query it
supports"):

| Table | Index | Query it supports |
|---|---|---|
| `admin_consumer_inbox` | `(consumer_name, event_id)` UNIQUE | idempotency check before every projection write |
| `admin_driver_projection` | `(status, region_id)` | "drivers with status X in region Y" |
| | `(availability_status)` | availability filter, independent of the above |
| | `(last_seen_at)` | staleness sort/filter |
| `admin_ride_projection` | `(status, updated_at)` | dashboard "searching rides" count / status lists sorted by recency |
| | `(region_id, status)` | regional breakdowns |
| | `(driver_id, updated_at)` | one driver's ride history |
| | `(customer_id, updated_at)` | one customer's ride history |
| | `(requested_at)` | date-range filtering |
| `admin_ride_offer_projection` | `(ride_request_id)` | `GET /rides/{id}/offers` — the only access pattern this table serves |
| `admin_trip_projection` | same five as `admin_ride_projection`, on trip's own columns | same reasoning, trip-scoped |
| `admin_payment_projection` | `(status)` | "find failed payments to retry" |
| | `(region_id, status)` | regional `failed_payments_today` |
| | `(trip_id)` | payment lookup from a trip detail view |
| `admin_region_metrics` | none beyond the `region_id` primary key | one row per region — every real access pattern is already optimal |

No `admin_daily_metrics`, `admin_live_metrics`, or `admin_incidents`
tables — these appeared in the original spec's "potential tables" list
but weren't part of Phase 3's actual scope (driver/ride/trip/payment
projections + regional metrics + inbox). Building them now, with no
consumer to feed them and no query to serve, would be exactly the kind of
premature schema AGENTS.md's indexing rule already argues against. Add
them in whichever future phase has a concrete query or event source that
needs one.

## What Phase 3 does not do

No projection consumer writes to any of these tables yet — that's
Phase 4. No query endpoint reads from them yet — that's Phase 5. This
phase only proves the schema itself is correct: migrations apply and roll
back cleanly against the live `admin_api` role, and a real Kysely
insert/select/delete round-trip against `admin_region_metrics` returns
correctly-typed data (verified live, not just compiled).
