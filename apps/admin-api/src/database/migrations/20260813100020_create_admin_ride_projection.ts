import { Kysely, sql } from 'kysely';

/**
 * Fed by ride.requested/search.started/offer.created/assigned/
 * unavailable.v1 (all live — docs/events/topic-catalog.md), once Phase 4
 * builds the consumers. `ride_request_id` is the ride's own public uuid,
 * used directly as the primary key.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('admin_ride_projection')
    .addColumn('ride_request_id', 'uuid', (col) => col.primaryKey())
    .addColumn('customer_id', 'uuid', (col) => col.notNull())
    .addColumn('driver_id', 'uuid')
    .addColumn('region_id', 'text')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('pickup_latitude', 'double precision')
    .addColumn('pickup_longitude', 'double precision')
    .addColumn('dropoff_latitude', 'double precision')
    .addColumn('dropoff_longitude', 'double precision')
    .addColumn('requested_at', 'timestamptz')
    .addColumn('search_started_at', 'timestamptz')
    .addColumn('assigned_at', 'timestamptz')
    .addColumn('unavailable_at', 'timestamptz')
    .addColumn('cancelled_at', 'timestamptz')
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Supports: dashboard "searching rides" count / status-filtered lists
  // sorted by recency.
  await db.schema
    .createIndex('admin_ride_projection_status_updated_idx')
    .on('admin_ride_projection')
    .columns(['status', 'updated_at'])
    .execute();

  // Supports: regional dashboard breakdowns filtered by status.
  await db.schema
    .createIndex('admin_ride_projection_region_status_idx')
    .on('admin_ride_projection')
    .columns(['region_id', 'status'])
    .execute();

  // Supports: "rides handled by driver X" timeline.
  await db.schema
    .createIndex('admin_ride_projection_driver_updated_idx')
    .on('admin_ride_projection')
    .columns(['driver_id', 'updated_at'])
    .execute();

  // Supports: "rides requested by customer X" timeline.
  await db.schema
    .createIndex('admin_ride_projection_customer_updated_idx')
    .on('admin_ride_projection')
    .columns(['customer_id', 'updated_at'])
    .execute();

  // Supports: date-range filtering ("rides today").
  await db.schema
    .createIndex('admin_ride_projection_requested_at_idx')
    .on('admin_ride_projection')
    .column('requested_at')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('admin_ride_projection').execute();
}
