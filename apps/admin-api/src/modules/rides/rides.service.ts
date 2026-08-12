import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, Selectable } from 'kysely';
import { KYSELY_DB } from '../../database/database.module';
import { Database } from '../../database/schema';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { ListRidesDto } from './dto/list-rides.dto';

const RIDE_COLUMNS = [
  'ride_request_id',
  'customer_id',
  'driver_id',
  'region_id',
  'status',
  'pickup_latitude',
  'pickup_longitude',
  'dropoff_latitude',
  'dropoff_longitude',
  'requested_at',
  'search_started_at',
  'assigned_at',
  'unavailable_at',
  'cancelled_at',
  'updated_at',
] as const;

export type RideRow = Pick<
  Selectable<Database['admin_ride_projection']>,
  (typeof RIDE_COLUMNS)[number]
>;

export interface RideMilestone {
  event: string;
  at: Date;
}

/**
 * `requested`/`search_started`/`assigned`/`unavailable`/`cancelled` are
 * the milestones this platform's actual events give us — real timestamps
 * already stored on the row, not derived or guessed. Two milestones the
 * original spec's own inspection list names aren't derivable from any
 * event this platform produces: `drivers_considered` (only exists as a
 * Prometheus histogram observation in dispatch-service, never tied to a
 * specific ride_request_id) and a distinct `offers_expired` moment (there
 * is deliberately no `ride.offer.expired.v1` topic — see
 * docs/events/topic-catalog.md). GET /rides/:id/offers exposes an
 * `is_expired` flag computed from `expires_at` instead — the closest
 * honest substitute.
 */
export interface RideDetail extends RideRow {
  timeline: RideMilestone[];
}

const OFFER_COLUMNS = [
  'offer_id',
  'ride_request_id',
  'driver_id',
  'status',
  'created_at',
  'expires_at',
  'responded_at',
  'updated_at',
] as const;

type OfferRow = Pick<
  Selectable<Database['admin_ride_offer_projection']>,
  (typeof OFFER_COLUMNS)[number]
>;

export interface RideOfferSummary extends OfferRow {
  /** True for a still-'pending' offer whose expires_at has already passed — see the RideDetail comment above. */
  is_expired: boolean;
}

function buildTimeline(row: RideRow): RideMilestone[] {
  const milestones: RideMilestone[] = [];
  const add = (event: string, at: Date | null): void => {
    if (at) milestones.push({ event, at });
  };
  add('requested', row.requested_at);
  add('search_started', row.search_started_at);
  add('assigned', row.assigned_at);
  add('unavailable', row.unavailable_at);
  add('cancelled', row.cancelled_at);
  return milestones.sort((a, b) => a.at.getTime() - b.at.getTime());
}

@Injectable()
export class RidesService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async list(filters: ListRidesDto): Promise<PaginatedResponse<RideRow>> {
    let query = this.db
      .selectFrom('admin_ride_projection')
      .select(RIDE_COLUMNS);

    if (filters.status) {
      query = query.where('status', '=', filters.status);
    }
    if (filters.region_id) {
      query = query.where('region_id', '=', filters.region_id);
    }
    if (filters.customer_id) {
      query = query.where('customer_id', '=', filters.customer_id);
    }
    if (filters.driver_id) {
      query = query.where('driver_id', '=', filters.driver_id);
    }
    if (filters.date_from) {
      query = query.where('requested_at', '>=', new Date(filters.date_from));
    }
    if (filters.date_to) {
      query = query.where('requested_at', '<=', new Date(filters.date_to));
    }

    const cursor = decodeCursor(filters.cursor);
    if (cursor) {
      query = query.where((eb) =>
        eb.or([
          eb('updated_at', '<', cursor.updatedAt),
          eb.and([
            eb('updated_at', '=', cursor.updatedAt),
            eb('ride_request_id', '<', cursor.id),
          ]),
        ]),
      );
    }

    const rows = await query
      .orderBy('updated_at', 'desc')
      .orderBy('ride_request_id', 'desc')
      .limit(filters.limit + 1)
      .execute();

    const hasMore = rows.length > filters.limit;
    const page = rows.slice(0, filters.limit);
    const last = page[page.length - 1];

    return {
      data: page,
      meta: {
        next_cursor:
          hasMore && last
            ? encodeCursor({
                updatedAt: last.updated_at,
                id: last.ride_request_id,
              })
            : null,
      },
    };
  }

  async findOne(rideRequestId: string): Promise<RideDetail> {
    const row = await this.db
      .selectFrom('admin_ride_projection')
      .select(RIDE_COLUMNS)
      .where('ride_request_id', '=', rideRequestId)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundException({
        code: 'ride_not_found',
        message: 'Ride request was not found.',
      });
    }

    return { ...row, timeline: buildTimeline(row) };
  }

  async listOffers(rideRequestId: string): Promise<RideOfferSummary[]> {
    const rideExists = await this.db
      .selectFrom('admin_ride_projection')
      .select('ride_request_id')
      .where('ride_request_id', '=', rideRequestId)
      .executeTakeFirst();
    if (!rideExists) {
      throw new NotFoundException({
        code: 'ride_not_found',
        message: 'Ride request was not found.',
      });
    }

    const rows = await this.db
      .selectFrom('admin_ride_offer_projection')
      .select(OFFER_COLUMNS)
      .where('ride_request_id', '=', rideRequestId)
      .orderBy('created_at', 'asc')
      .limit(100)
      .execute();

    const now = Date.now();
    return rows.map((row) => ({
      ...row,
      is_expired:
        row.status === 'pending' &&
        !!row.expires_at &&
        row.expires_at.getTime() < now,
    }));
  }
}
