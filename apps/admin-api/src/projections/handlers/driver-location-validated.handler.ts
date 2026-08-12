import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { Database } from '../../database/schema';
import { EventEnvelope } from '../../integrations/kafka/envelope';
import { ProjectionHandler } from './projection-handler.interface';

interface DriverLocationValidatedData {
  driver_id: string;
  device_id: string;
  trip_id: string | null;
  sequence: number;
  latitude: number;
  longitude: number;
  accuracy_meters: number;
  speed_mps: number | null;
  heading_degrees: number | null;
  recorded_at: string;
}

/**
 * Highest-volume topic in the platform (docs/architecture/scalability.md)
 * — every accepted GPS ping. `active_trip_id` is set straight from this
 * event's own `trip_id`, including back to NULL once a driver's pings stop
 * carrying one (correct: it should reflect the driver's most recent
 * reported trip association, not accumulate stale state).
 */
@Injectable()
export class DriverLocationValidatedHandler implements ProjectionHandler<DriverLocationValidatedData> {
  readonly eventType = 'driver.location.validated';
  readonly consumerName = 'admin-api.driver-location-validated-projection';

  async handle(
    envelope: EventEnvelope<DriverLocationValidatedData>,
    trx: Transaction<Database>,
  ): Promise<void> {
    const occurredAt = new Date(envelope.occurred_at);
    const recordedAt = new Date(envelope.data.recorded_at);

    await trx
      .insertInto('admin_driver_projection')
      .values({
        driver_id: envelope.data.driver_id,
        region_id: envelope.region_id,
        last_location_at: recordedAt,
        last_seen_at: occurredAt,
        active_trip_id: envelope.data.trip_id,
        updated_at: occurredAt,
      })
      .onConflict((oc) =>
        oc.column('driver_id').doUpdateSet({
          region_id: envelope.region_id,
          last_location_at: recordedAt,
          last_seen_at: occurredAt,
          active_trip_id: envelope.data.trip_id,
          updated_at: occurredAt,
        }),
      )
      .execute();
  }
}
