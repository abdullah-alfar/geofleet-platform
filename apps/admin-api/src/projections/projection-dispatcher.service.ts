import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely } from 'kysely';
import { KYSELY_DB } from '../database/database.module';
import { Database } from '../database/schema';
import { EventEnvelope } from '../integrations/kafka/envelope';
import { PROJECTION_HANDLERS } from './projection-handlers.token';
import { ProjectionHandler } from './handlers/projection-handler.interface';

/**
 * Same idempotency pattern as core-api's own inbox_events (AGENTS.md hard
 * invariant): the inbox insert and the projection write happen inside one
 * transaction, keyed on (consumer_name, event_id). `ON CONFLICT DO
 * NOTHING` makes a duplicate delivery a cheap, safe no-op — the handler
 * never even runs for an event already recorded.
 */
@Injectable()
export class ProjectionDispatcherService {
  private readonly logger = new Logger(ProjectionDispatcherService.name);
  private readonly handlersByEventType: Map<string, ProjectionHandler>;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    @Inject(PROJECTION_HANDLERS) handlers: ProjectionHandler[],
  ) {
    this.handlersByEventType = new Map(
      handlers.map((handler) => [handler.eventType, handler]),
    );
  }

  async dispatch(envelope: EventEnvelope): Promise<void> {
    const handler = this.handlersByEventType.get(envelope.event_type);
    if (!handler) {
      // Every live topic this consumer subscribes to has a handler
      // registered below — reaching this branch means a topic
      // subscription and its handler registration drifted apart, not a
      // routine "unknown event" case. Logged, not thrown: one malformed
      // registration shouldn't stall every other topic's consumption.
      this.logger.warn(
        `No projection handler registered for event_type "${envelope.event_type}" — ignoring.`,
      );
      return;
    }

    await this.db.transaction().execute(async (trx) => {
      const inboxInsert = await trx
        .insertInto('admin_consumer_inbox')
        .values({
          consumer_name: handler.consumerName,
          event_id: envelope.event_id,
          event_type: envelope.event_type,
          processed_at: new Date(),
        })
        .onConflict((oc) =>
          oc.columns(['consumer_name', 'event_id']).doNothing(),
        )
        .executeTakeFirst();

      if ((inboxInsert.numInsertedOrUpdatedRows ?? 0n) === 0n) {
        this.logger.debug(
          `${handler.consumerName}: event ${envelope.event_id} already processed — skipping.`,
        );
        return;
      }

      await handler.handle(envelope, trx);
    });
  }
}
