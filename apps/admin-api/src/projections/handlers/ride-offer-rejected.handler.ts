import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { Database } from '../../database/schema';
import { EventEnvelope } from '../../integrations/kafka/envelope';
import { ProjectionHandler } from './projection-handler.interface';

interface RideOfferRejectedData {
  ride_request_id: string;
  offer_id: string;
  driver_id: string;
}

@Injectable()
export class RideOfferRejectedHandler implements ProjectionHandler<RideOfferRejectedData> {
  readonly eventType = 'ride.offer.rejected';
  readonly consumerName = 'admin-api.ride-offer-rejected-projection';

  async handle(
    envelope: EventEnvelope<RideOfferRejectedData>,
    trx: Transaction<Database>,
  ): Promise<void> {
    const occurredAt = new Date(envelope.occurred_at);

    await trx
      .insertInto('admin_ride_offer_projection')
      .values({
        offer_id: envelope.data.offer_id,
        ride_request_id: envelope.data.ride_request_id,
        driver_id: envelope.data.driver_id,
        status: 'rejected',
        responded_at: occurredAt,
        updated_at: occurredAt,
      })
      .onConflict((oc) =>
        oc.column('offer_id').doUpdateSet({
          status: 'rejected',
          responded_at: occurredAt,
          updated_at: occurredAt,
        }),
      )
      .execute();
  }
}
