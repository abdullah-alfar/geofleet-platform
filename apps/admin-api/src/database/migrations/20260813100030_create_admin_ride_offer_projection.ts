import { Kysely, sql } from 'kysely';

/**
 * One row per driver offered a given ride — fed by ride.offer.created/
 * accepted/rejected.v1 (all live). Powers
 * GET /api/v1/admin/rides/{id}/offers (per-offer operational visibility
 * the original spec calls for: offers_created, offers_expired,
 * offers_rejected, driver_assigned). Not merged into
 * admin_ride_projection because one ride request can accumulate several
 * offers across its matching attempts — a single row per ride can't
 * represent that history.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('admin_ride_offer_projection')
    .addColumn('offer_id', 'uuid', (col) => col.primaryKey())
    .addColumn('ride_request_id', 'uuid', (col) => col.notNull())
    .addColumn('driver_id', 'uuid', (col) => col.notNull())
    .addColumn('status', 'text', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz')
    .addColumn('expires_at', 'timestamptz')
    .addColumn('responded_at', 'timestamptz')
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  // Supports: GET /api/v1/admin/rides/{id}/offers — every offer for one
  // ride request, the only access pattern this table serves today.
  await db.schema
    .createIndex('admin_ride_offer_projection_ride_idx')
    .on('admin_ride_offer_projection')
    .column('ride_request_id')
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('admin_ride_offer_projection').execute();
}
