# Partitioning

The first (and so far only) declaratively partitioned table is
`trip_location_samples`, introduced in Phase 4
(`apps/core-api/database/migrations/2026_08_06_200000_create_trip_location_samples_table.php`).
`audit_logs` is a listed candidate for partitioning in the original brief
but hasn't needed it yet at local-dev volume — revisit if/when audit log
retention/pruning actually becomes a performance concern.

## Why `trip_location_samples`

It's the highest-volume durable table in the schema: one row per sampled
GPS point per active trip (throttled — see
[docs/events/topic-catalog.md](../events/topic-catalog.md) and
`App\Domain\Location\LocationSampler`). Time-based partitioning lets old
months be dropped or archived cheaply (`DROP TABLE
trip_location_samples_y2026m01` is instant — no row-by-row `DELETE`) once a
retention policy prunes them (see [retention.md](retention.md)).

## Partitioning strategy

`PARTITION BY RANGE (recorded_at)`, one partition per calendar month.
Monthly (not daily) because local-dev and early-production GPS volume
doesn't come close to justifying daily partitions — see the brief's
capacity assumptions (~20k updates/sec at full projected scale, but this
table only stores *sampled* points, roughly every 15s or 30m of movement
per active trip, which is a tiny fraction of raw GPS throughput). Revisit
if a region's real trip volume changes that math.

### The composite primary key

Postgres requires any unique constraint (including the primary key) on a
partitioned table to include the partition key column. So the primary key
is `(id, recorded_at)`, not just `id`. `id` still comes from a single
`BIGSERIAL` sequence shared across all partitions, so it remains globally
unique in practice — Postgres just doesn't *enforce* that uniqueness
on its own past the composite key. This table is never looked up by `id`
alone (queries go through `trip_id` + `recorded_at`), so this has no
practical effect on how the table is used.

### Indexes propagate automatically

Both indexes (`trip_location_samples_trip_id_recorded_at_idx` and the GiST
`trip_location_samples_location_gist`) are created once on the parent
partitioned table. Postgres 11+ automatically creates a matching index on
every partition that exists at the time, **and** on any partition attached
afterward via `CREATE TABLE ... PARTITION OF ...` — confirmed for this
schema in Phase 4's verification pass (`\d
trip_location_samples_y2026m08` shows all three indexes without them being
created per-partition manually).

## Operational story: adding future partitions

The migration creates partitions for the **current month and next month**
at migration time. That's enough for any single local-dev session, but
this repo has no automated job yet that creates next month's partition
before it's needed — inserting a `recorded_at` value outside every
existing partition's range fails with a Postgres error
("no partition of relation ... found for row").

This is a known, intentional gap for the current phase (matches AGENTS.md:
don't build ahead of schedule). Before this matters in a long-running
deployment, add either:

- A scheduled Laravel command (`artisan schedule`) that ensures the next
  month's partition exists, run monthly — the natural Phase 7
  (Reliability) "operational commands" deliverable, or
- A `pg_partman`-managed partition set, if the operational overhead of a
  hand-rolled scheduled command isn't worth it at real scale.

Until then, if a local dev session or demo runs past a month boundary,
manually create the next partition:

```sql
CREATE TABLE trip_location_samples_y2026m10
PARTITION OF trip_location_samples
FOR VALUES FROM ('2026-10-01') TO ('2026-11-01');
```
