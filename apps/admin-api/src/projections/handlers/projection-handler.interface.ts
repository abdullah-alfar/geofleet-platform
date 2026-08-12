import type { Transaction } from 'kysely';
import type { Database } from '../../database/schema';
import type { EventEnvelope } from '../../integrations/kafka/envelope';

/**
 * One handler per event_type (not one giant switch statement) — event
 * parsing (envelope.ts) stays separate from projection logic (each
 * handler only deals in its own `data` shape).
 */
export interface ProjectionHandler<T = unknown> {
  readonly eventType: string;
  /** admin_consumer_inbox.consumer_name — see ProjectionDispatcherService. */
  readonly consumerName: string;
  handle(envelope: EventEnvelope<T>, trx: Transaction<Database>): Promise<void>;
}
