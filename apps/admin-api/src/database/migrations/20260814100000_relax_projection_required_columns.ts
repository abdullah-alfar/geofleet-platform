import { Kysely } from 'kysely';

/**
 * Phase 3's schema assumed richer event payloads than Phase 4's actual
 * producer research found. Two real gaps, both caught before any handler
 * was written against the wrong assumption (see
 * docs/admin-api/kafka-projections.md):
 *
 * - `driver.status.changed.v1`'s entire payload is
 *   `{ driver_id, is_available }` — no event carries a driver's name or
 *   approval status at all. `admin_driver_projection.name`/`.status`
 *   could never have been satisfied.
 * - `ride.requested.v1` carries `customer_id`, but it's a different Kafka
 *   topic than `ride.search.started.v1`/`ride.assigned.v1`/
 *   `ride.unavailable.v1` — Kafka's per-key ordering guarantee is
 *   per-topic-partition, not cross-topic, so a defensive upsert for those
 *   other ride events (in case one is ever consumed before
 *   `ride.requested.v1` finishes replaying) can't guarantee having a
 *   customer_id yet.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .alterTable('admin_driver_projection')
    .alterColumn('name', (col) => col.dropNotNull())
    .execute();
  await db.schema
    .alterTable('admin_driver_projection')
    .alterColumn('status', (col) => col.dropNotNull())
    .execute();
  await db.schema
    .alterTable('admin_ride_projection')
    .alterColumn('customer_id', (col) => col.dropNotNull())
    .execute();
}

export function down(): Promise<void> {
  // Deliberately not reversed: once Phase 4's consumers run, rows with
  // NULL name/status/customer_id will genuinely exist, and re-adding
  // NOT NULL would fail against real data. These are rebuildable
  // projections (the whole point of this schema) — if this needs
  // reverting, drop and re-migrate the table instead of rolling back a
  // constraint over live data.
  return Promise.resolve();
}
