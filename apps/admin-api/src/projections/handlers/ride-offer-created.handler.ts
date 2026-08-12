import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { Database } from '../../database/schema';
import { EventEnvelope } from '../../integrations/kafka/envelope';
import { ProjectionHandler } from './projection-handler.interface';

interface RideOfferCreatedData {
  ride_request_id: string;
  offer_id: string;
  driver_id: string;
  expires_at: string;
}

/**
 * Doesn't touch admin_ride_projection.driver_id — that column means "the
 * assigned driver" (set only by ride.assigned.v1), not "a candidate
 * currently holding an offer." Offer-level state lives entirely in
 * admin_ride_offer_projection, which is what
 * GET /api/v1/admin/rides/{id}/offers reads.
 */
@Injectable()
export class RideOfferCreatedHandler implements ProjectionHandler<RideOfferCreatedData> {
  readonly eventType = 'ride.offer.created';
  readonly consumerName = 'admin-api.ride-offer-created-projection';

  async handle(
    envelope: EventEnvelope<RideOfferCreatedData>,
    trx: Transaction<Database>,
  ): Promise<void> {
    const occurredAt = new Date(envelope.occurred_at);

    await trx
      .insertInto('admin_ride_offer_projection')
      .values({
        offer_id: envelope.data.offer_id,
        ride_request_id: envelope.data.ride_request_id,
        driver_id: envelope.data.driver_id,
        status: 'pending',
        created_at: occurredAt,
        expires_at: new Date(envelope.data.expires_at),
        updated_at: occurredAt,
      })
      .onConflict((oc) =>
        oc.column('offer_id').doUpdateSet({
          status: 'pending',
          expires_at: new Date(envelope.data.expires_at),
          updated_at: occurredAt,
        }),
      )
      .execute();
  }
}
