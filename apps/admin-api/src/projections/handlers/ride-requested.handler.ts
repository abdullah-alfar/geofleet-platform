import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { Database } from '../../database/schema';
import { EventEnvelope } from '../../integrations/kafka/envelope';
import { ProjectionHandler } from './projection-handler.interface';

interface RideRequestedData {
  ride_request_id: string;
  customer_id: string;
  region_id: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
  requested_vehicle_type: string;
}

/** The root event of the ride lifecycle — always the first sighting of a ride_request_id. */
@Injectable()
export class RideRequestedHandler implements ProjectionHandler<RideRequestedData> {
  readonly eventType = 'ride.requested';
  readonly consumerName = 'admin-api.ride-requested-projection';

  async handle(
    envelope: EventEnvelope<RideRequestedData>,
    trx: Transaction<Database>,
  ): Promise<void> {
    const occurredAt = new Date(envelope.occurred_at);

    await trx
      .insertInto('admin_ride_projection')
      .values({
        ride_request_id: envelope.data.ride_request_id,
        customer_id: envelope.data.customer_id,
        region_id: envelope.region_id,
        status: 'searching',
        pickup_latitude: envelope.data.pickup.lat,
        pickup_longitude: envelope.data.pickup.lng,
        dropoff_latitude: envelope.data.dropoff.lat,
        dropoff_longitude: envelope.data.dropoff.lng,
        requested_at: occurredAt,
        updated_at: occurredAt,
      })
      .onConflict((oc) =>
        oc.column('ride_request_id').doUpdateSet({
          customer_id: envelope.data.customer_id,
          region_id: envelope.region_id,
          pickup_latitude: envelope.data.pickup.lat,
          pickup_longitude: envelope.data.pickup.lng,
          dropoff_latitude: envelope.data.dropoff.lat,
          dropoff_longitude: envelope.data.dropoff.lng,
          updated_at: occurredAt,
        }),
      )
      .execute();
  }
}
