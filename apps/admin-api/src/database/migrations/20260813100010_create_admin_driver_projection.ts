import { Kysely, sql } from 'kysely';

/**
 * Fed by driver.status.changed.v1 + driver.location.validated.v1 (both
 * live — docs/events/topic-catalog.md), once Phase 4 builds the
 * consumers. `driver_id` is the driver's own public uuid, used directly
 * as the primary key — this table is upserted by driver id, never
 * auto-incremented.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('admin_driver_projection')
    .addColumn('driver_id', 'uuid', (col) => col.primaryKey())
    .addColumn('name', 'text', (col) => col.notNull())
    .addColumn('phone_masked', 'text')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('availability_status', 'text')
    .addColumn('vehicle_type', 'text')
    .addColumn('rating', sql`numeric(3, 2)`)
    .addColumn('region_id', 'text')
    .addColumn('last_location_at', 'timestamptz')
    .addColumn('last_seen_at', 'timestamptz')
    .addColumn('active_trip_id', 'uuid')
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Supports: "active drivers with status X in region Y" (Drivers Admin
  // API's status + region_id filters used together).
  await db.schema
    .createIndex('admin_driver_projection_status_region_idx')
    .on('admin_driver_projection')
    .columns(['status', 'region_id'])
    .execute();

  // Supports: filtering by availability_status alone (independent of the
  // status+region_id combination above).
  await db.schema
    .createIndex('admin_driver_projection_availability_idx')
    .on('admin_driver_projection')
    .column('availability_status')
    .execute();

  // Supports: staleness queries / default sort ("who hasn't been seen
  // recently" — an operational health signal, not just a display field).
  await db.schema
    .createIndex('admin_driver_projection_last_seen_idx')
    .on('admin_driver_projection')
    .column('last_seen_at')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('admin_driver_projection').execute();
}
