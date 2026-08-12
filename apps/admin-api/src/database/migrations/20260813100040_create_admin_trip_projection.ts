import { Kysely, sql } from 'kysely';

/**
 * Fed by trip.started/completed/cancelled.v1 — all "planned" in
 * docs/events/topic-catalog.md (core-api has no consumer for
 * ride.assigned.v1 yet, so no `trips` row is ever created there — see
 * docs/architecture/data-flow.md's Flow 1 note). This table is built now
 * (Phase 3 scope) but stays empty until that producer-side gap closes;
 * Phase 4's consumer will exist and be correct, just idle, same as
 * core-api's own LocationSampler today.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('admin_trip_projection')
    .addColumn('trip_id', 'uuid', (col) => col.primaryKey())
    .addColumn('customer_id', 'uuid', (col) => col.notNull())
    .addColumn('driver_id', 'uuid', (col) => col.notNull())
    .addColumn('region_id', 'text')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('pickup_latitude', 'double precision')
    .addColumn('pickup_longitude', 'double precision')
    .addColumn('dropoff_latitude', 'double precision')
    .addColumn('dropoff_longitude', 'double precision')
    .addColumn('requested_at', 'timestamptz')
    .addColumn('accepted_at', 'timestamptz')
    .addColumn('started_at', 'timestamptz')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('cancelled_at', 'timestamptz')
    .addColumn('estimated_price', sql`numeric(10, 2)`)
    .addColumn('final_price', sql`numeric(10, 2)`)
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Supports: dashboard "active trips" count / status-filtered lists
  // sorted by recency.
  await db.schema
    .createIndex('admin_trip_projection_status_updated_idx')
    .on('admin_trip_projection')
    .columns(['status', 'updated_at'])
    .execute();

  // Supports: regional dashboard breakdowns filtered by status.
  await db.schema
    .createIndex('admin_trip_projection_region_status_idx')
    .on('admin_trip_projection')
    .columns(['region_id', 'status'])
    .execute();

  // Supports: "trips driven by driver X" timeline.
  await db.schema
    .createIndex('admin_trip_projection_driver_updated_idx')
    .on('admin_trip_projection')
    .columns(['driver_id', 'updated_at'])
    .execute();

  // Supports: "trips taken by customer X" timeline.
  await db.schema
    .createIndex('admin_trip_projection_customer_updated_idx')
    .on('admin_trip_projection')
    .columns(['customer_id', 'updated_at'])
    .execute();

  // Supports: date-range filtering (Trips Admin API's date_from/date_to).
  await db.schema
    .createIndex('admin_trip_projection_requested_at_idx')
    .on('admin_trip_projection')
    .column('requested_at')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('admin_trip_projection').execute();
}
