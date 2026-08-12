import { Kysely, sql } from 'kysely';

/**
 * One row per region, upserted by Phase 4's consumers/a periodic
 * aggregation job (not decided yet — see docs/admin-api/read-models.md).
 * Precomputed so GET /api/v1/admin/dashboard/regions never runs a
 * COUNT/GROUP BY across the driver/trip/ride projections on every
 * request — the "Admin Dashboard Philosophy" this whole schema exists to
 * satisfy. No extra index beyond the primary key: every real access
 * pattern (one region, or all of them for the dashboard) is already
 * optimal against a table with one row per region.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('admin_region_metrics')
    .addColumn('region_id', 'text', (col) => col.primaryKey())
    .addColumn('online_drivers', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('available_drivers', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('active_trips', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('searching_rides', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('rides_today', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('completed_today', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('cancelled_today', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('failed_payments_today', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('average_match_time_ms', 'integer')
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('admin_region_metrics').execute();
}
