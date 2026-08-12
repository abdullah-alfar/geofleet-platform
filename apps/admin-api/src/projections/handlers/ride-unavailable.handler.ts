import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { Database } from '../../database/schema';
import { EventEnvelope } from '../../integrations/kafka/envelope';
import { ProjectionHandler } from './projection-handler.interface';

interface RideUnavailableData {
  ride_request_id: string;
}

/**
 * `data` deliberately has no customer_id — dispatch-service's own PII
 * scope boundary (docs/events/topic-catalog.md,
 * docs/decisions/0006-realtime-gateway-fanout.md). Never overwrites
 * customer_id on conflict; only sets it (to NULL) on the rare defensive-
 * insert path where this event is somehow the first sighting of the ride.
 */
@Injectable()
export class RideUnavailableHandler implements ProjectionHandler<RideUnavailableData> {
  readonly eventType = 'ride.unavailable';
  readonly consumerName = 'admin-api.ride-unavailable-projection';

  async handle(
    envelope: EventEnvelope<RideUnavailableData>,
    trx: Transaction<Database>,
  ): Promise<void> {
    const occurredAt = new Date(envelope.occurred_at);

    await trx
      .insertInto('admin_ride_projection')
      .values({
        ride_request_id: envelope.data.ride_request_id,
        region_id: envelope.region_id,
        status: 'unavailable',
        unavailable_at: occurredAt,
        updated_at: occurredAt,
      })
      .onConflict((oc) =>
        oc.column('ride_request_id').doUpdateSet({
          status: 'unavailable',
          unavailable_at: occurredAt,
          updated_at: occurredAt,
        }),
      )
      .execute();
  }
}
