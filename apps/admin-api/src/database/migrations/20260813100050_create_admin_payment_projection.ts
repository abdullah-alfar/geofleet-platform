import { Kysely, sql } from 'kysely';

/**
 * Fed by payment.requested/completed/failed.v1 — all "planned" in
 * docs/events/topic-catalog.md, zero producer exists in core-api yet.
 * Built now (Phase 3 scope) but will stay empty until that integration
 * lands — see admin_trip_projection's migration for the same honest gap
 * on a different table.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('admin_payment_projection')
    .addColumn('payment_id', 'uuid', (col) => col.primaryKey())
    .addColumn('trip_id', 'uuid')
    .addColumn('customer_id', 'uuid')
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('provider', 'text')
    .addColumn('amount', sql`numeric(10, 2)`)
    .addColumn('currency', 'text')
    .addColumn('region_id', 'text')
    .addColumn('created_at', 'timestamptz')
    .addColumn('paid_at', 'timestamptz')
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Supports: admin filtering for failed payments to retry — the same
  // query docs/database/indexes.md already documents this need for on
  // core-api's own (unbuilt) payments table.
  await db.schema
    .createIndex('admin_payment_projection_status_idx')
    .on('admin_payment_projection')
    .column('status')
    .execute();

  // Supports: regional dashboard breakdowns filtered by status
  // ("failed_payments_today" per region).
  await db.schema
    .createIndex('admin_payment_projection_region_status_idx')
    .on('admin_payment_projection')
    .columns(['region_id', 'status'])
    .execute();

  // Supports: "payment for trip X" lookup from a trip detail view.
  await db.schema
    .createIndex('admin_payment_projection_trip_idx')
    .on('admin_payment_projection')
    .column('trip_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('admin_payment_projection').execute();
}
