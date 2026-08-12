import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { Database } from '../../database/schema';
import { EventEnvelope } from '../../integrations/kafka/envelope';
import { ProjectionHandler } from './projection-handler.interface';

interface DriverStatusChangedData {
  driver_id: string;
  is_available: boolean;
}

/**
 * The entire payload core-api's DriverAvailabilityController publishes is
 * `{ driver_id, is_available }` — see
 * docs/admin-api/kafka-projections.md. No name, no approval status, no
 * vehicle/rating data. Those columns stay NULL on a driver never seen by
 * any other handler; there is currently no live event that could fill
 * them in.
 */
@Injectable()
export class DriverStatusChangedHandler implements ProjectionHandler<DriverStatusChangedData> {
  readonly eventType = 'driver.status.changed';
  readonly consumerName = 'admin-api.driver-status-changed-projection';

  async handle(
    envelope: EventEnvelope<DriverStatusChangedData>,
    trx: Transaction<Database>,
  ): Promise<void> {
    const occurredAt = new Date(envelope.occurred_at);
    const availabilityStatus = envelope.data.is_available
      ? 'available'
      : 'unavailable';

    await trx
      .insertInto('admin_driver_projection')
      .values({
        driver_id: envelope.data.driver_id,
        availability_status: availabilityStatus,
        region_id: envelope.region_id,
        last_seen_at: occurredAt,
        updated_at: occurredAt,
      })
      .onConflict((oc) =>
        oc.column('driver_id').doUpdateSet({
          availability_status: availabilityStatus,
          region_id: envelope.region_id,
          last_seen_at: occurredAt,
          updated_at: occurredAt,
        }),
      )
      .execute();
  }
}
