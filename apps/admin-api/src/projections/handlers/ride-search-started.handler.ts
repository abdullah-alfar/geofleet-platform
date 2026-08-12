import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { Database } from '../../database/schema';
import { EventEnvelope } from '../../integrations/kafka/envelope';
import { ProjectionHandler } from './projection-handler.interface';

interface RideSearchStartedData {
  ride_request_id: string;
}

/**
 * Defensive upsert, not a plain UPDATE: this is a different Kafka topic
 * than ride.requested.v1, so cross-topic ordering isn't guaranteed (see
 * the schema migration that made customer_id nullable for this exact
 * reason). On conflict, only search_started_at/updated_at are touched —
 * never clobbers fields this event has no data for.
 */
@Injectable()
export class RideSearchStartedHandler implements ProjectionHandler<RideSearchStartedData> {
  readonly eventType = 'ride.search.started';
  readonly consumerName = 'admin-api.ride-search-started-projection';

  async handle(
    envelope: EventEnvelope<RideSearchStartedData>,
    trx: Transaction<Database>,
  ): Promise<void> {
    const occurredAt = new Date(envelope.occurred_at);

    await trx
      .insertInto('admin_ride_projection')
      .values({
        ride_request_id: envelope.data.ride_request_id,
        region_id: envelope.region_id,
        status: 'searching',
        search_started_at: occurredAt,
        updated_at: occurredAt,
      })
      .onConflict((oc) =>
        oc.column('ride_request_id').doUpdateSet({
          search_started_at: occurredAt,
          updated_at: occurredAt,
        }),
      )
      .execute();
  }
}
