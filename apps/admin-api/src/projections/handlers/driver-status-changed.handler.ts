import { Injectable } from '@nestjs/common';
import type { Transaction } from 'kysely';
import { Database } from '../../database/schema';
import { EventEnvelope } from '../../integrations/kafka/envelope';
import { ProjectionHandler } from './projection-handler.interface';

interface DriverStatusChangedData {
  driver_id: string;
  is_available: boolean;
  /** Absent from DriverAvailabilityController's own publishes (the
   * driver's own toggle never changes `drivers.status`) — present from
   * every admin command (DriverCommandController::publishStatusChanged,
   * core-api). Optional at the type level on purpose: this handler must
   * be able to tell "no status in this event" apart from "status changed
   * to some falsy-looking value," so it can leave the projection's own
   * `status` column untouched for a plain availability toggle instead of
   * accidentally clobbering it. */
  status?: string;
}

/**
 * core-api's DriverAvailabilityController (the driver's own toggle)
 * publishes `{ driver_id, is_available }` only. Every admin command
 * (approve/suspend/unsuspend/disable — DriverCommandController) also
 * includes `status`. A real gap caught live: before `status` existed on
 * this event at all, nothing ever told this projection what an admin
 * command had actually done — `admin_driver_projection.status` stayed
 * frozen at whatever it started as (NULL) no matter how many times a
 * driver was approved or suspended through the admin panel, because
 * there was no *other* source for that column. See
 * docs/admin-api/kafka-projections.md.
 *
 * `name`/`phone_masked`/`vehicle_type`/`rating` remain permanently NULL
 * on a driver never seen by any other handler — genuinely no live event
 * carries any of those, unlike `status`, which this fix closes.
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
    const status = envelope.data.status;

    await trx
      .insertInto('admin_driver_projection')
      .values({
        driver_id: envelope.data.driver_id,
        availability_status: availabilityStatus,
        status: status ?? null,
        region_id: envelope.region_id,
        last_seen_at: occurredAt,
        updated_at: occurredAt,
      })
      .onConflict((oc) =>
        oc.column('driver_id').doUpdateSet({
          availability_status: availabilityStatus,
          // Only overwrite `status` when this event actually carries
          // one — a plain availability toggle from the driver's own
          // endpoint must not reset an admin-set status back to NULL.
          ...(status !== undefined ? { status } : {}),
          region_id: envelope.region_id,
          last_seen_at: occurredAt,
          updated_at: occurredAt,
        }),
      )
      .execute();
  }
}
