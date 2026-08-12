import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { Database } from '../../database/schema';
import { EventEnvelope } from '../../integrations/kafka/envelope';
import { ProjectionHandler } from './projection-handler.interface';

interface RideAssignedData {
  ride_request_id: string;
  driver_id: string;
  customer_id: string;
}

/**
 * Doesn't touch admin_driver_projection.active_trip_id — that's driven
 * solely by driver.location.validated.v1's own trip_id field (which
 * stays NULL until core-api's trip-creation gap closes, same honest gap
 * docs/architecture/data-flow.md already documents). Conflating "ride
 * assigned" with "trip started" would be wrong: a trip doesn't exist
 * until the driver actually starts it.
 */
@Injectable()
export class RideAssignedHandler implements ProjectionHandler<RideAssignedData> {
  readonly eventType = 'ride.assigned';
  readonly consumerName = 'admin-api.ride-assigned-projection';

  async handle(
    envelope: EventEnvelope<RideAssignedData>,
    trx: Transaction<Database>,
  ): Promise<void> {
    const occurredAt = new Date(envelope.occurred_at);

    await trx
      .insertInto('admin_ride_projection')
      .values({
        ride_request_id: envelope.data.ride_request_id,
        customer_id: envelope.data.customer_id,
        driver_id: envelope.data.driver_id,
        region_id: envelope.region_id,
        status: 'assigned',
        assigned_at: occurredAt,
        updated_at: occurredAt,
      })
      .onConflict((oc) =>
        oc.column('ride_request_id').doUpdateSet({
          customer_id: envelope.data.customer_id,
          driver_id: envelope.data.driver_id,
          status: 'assigned',
          assigned_at: occurredAt,
          updated_at: occurredAt,
        }),
      )
      .execute();
  }
}
