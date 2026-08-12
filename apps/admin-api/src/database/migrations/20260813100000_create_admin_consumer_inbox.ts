import { Kysely, sql } from 'kysely';

/**
 * Idempotency ledger for Phase 4's projection consumers — same pattern
 * as core-api's own inbox_events (AGENTS.md hard invariant): unique on
 * (consumer_name, event_id), checked before a projection update and
 * inserted in the same transaction, so an at-least-once redelivery is a
 * safe no-op instead of a duplicate/incorrect projection write.
 */
export async function up(db: Kysely<unknown>): Promise<void> {
  await db.schema
    .createTable('admin_consumer_inbox')
    .addColumn('id', 'bigserial', (col) => col.primaryKey())
    .addColumn('consumer_name', 'text', (col) => col.notNull())
    .addColumn('event_id', 'uuid', (col) => col.notNull())
    .addColumn('event_type', 'text', (col) => col.notNull())
    .addColumn('processed_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('admin_consumer_inbox_consumer_event_unique')
    .on('admin_consumer_inbox')
    .columns(['consumer_name', 'event_id'])
    .unique()
    .execute();
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await db.schema.dropTable('admin_consumer_inbox').execute();
}
