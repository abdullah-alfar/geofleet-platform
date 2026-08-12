import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, Selectable, sql } from 'kysely';
import { KYSELY_DB } from '../../database/database.module';
import { Database } from '../../database/schema';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { ListTripsDto } from './dto/list-trips.dto';

const TRIP_COLUMNS = [
  'trip_id',
  'customer_id',
  'driver_id',
  'region_id',
  'status',
  'pickup_latitude',
  'pickup_longitude',
  'dropoff_latitude',
  'dropoff_longitude',
  'requested_at',
  'accepted_at',
  'started_at',
  'completed_at',
  'cancelled_at',
  'estimated_price',
  'final_price',
  'updated_at',
] as const;

export type TripRow = Pick<
  Selectable<Database['admin_trip_projection']>,
  (typeof TRIP_COLUMNS)[number]
>;

export interface TripMilestone {
  event: string;
  at: Date;
}

export interface TripDetail extends TripRow {
  timeline: TripMilestone[];
}

function buildTimeline(row: TripRow): TripMilestone[] {
  const milestones: TripMilestone[] = [];
  const add = (event: string, at: Date | null): void => {
    if (at) milestones.push({ event, at });
  };
  add('requested', row.requested_at);
  add('accepted', row.accepted_at);
  add('started', row.started_at);
  add('completed', row.completed_at);
  add('cancelled', row.cancelled_at);
  return milestones.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * `trip.started/completed/cancelled.v1` have no producer in core-api yet
 * (docs/admin-api/kafka-projections.md) — this table is always empty
 * today. Every query below is real and correct; it just has nothing to
 * return until that gap closes.
 */
@Injectable()
export class TripsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async list(filters: ListTripsDto): Promise<PaginatedResponse<TripRow>> {
    let query = this.db
      .selectFrom('admin_trip_projection')
      .select(TRIP_COLUMNS);

    if (filters.status) {
      query = query.where('status', '=', filters.status);
    }
    if (filters.region_id) {
      query = query.where('region_id', '=', filters.region_id);
    }
    if (filters.driver_id) {
      query = query.where('driver_id', '=', filters.driver_id);
    }
    if (filters.customer_id) {
      query = query.where('customer_id', '=', filters.customer_id);
    }
    if (filters.date_from) {
      query = query.where('requested_at', '>=', new Date(filters.date_from));
    }
    if (filters.date_to) {
      query = query.where('requested_at', '<=', new Date(filters.date_to));
    }
    if (filters.minimum_price !== undefined) {
      query = query.where(
        sql`coalesce(final_price, estimated_price)`,
        '>=',
        String(filters.minimum_price),
      );
    }
    if (filters.maximum_price !== undefined) {
      query = query.where(
        sql`coalesce(final_price, estimated_price)`,
        '<=',
        String(filters.maximum_price),
      );
    }

    const cursor = decodeCursor(filters.cursor);
    if (cursor) {
      query = query.where((eb) =>
        eb.or([
          eb('updated_at', '<', cursor.updatedAt),
          eb.and([
            eb('updated_at', '=', cursor.updatedAt),
            eb('trip_id', '<', cursor.id),
          ]),
        ]),
      );
    }

    const rows = await query
      .orderBy('updated_at', 'desc')
      .orderBy('trip_id', 'desc')
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
            ? encodeCursor({ updatedAt: last.updated_at, id: last.trip_id })
            : null,
      },
    };
  }

  async findOne(tripId: string): Promise<TripDetail> {
    const row = await this.db
      .selectFrom('admin_trip_projection')
      .select(TRIP_COLUMNS)
      .where('trip_id', '=', tripId)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundException({
        code: 'trip_not_found',
        message: 'Trip was not found.',
      });
    }

    return { ...row, timeline: buildTimeline(row) };
  }
}
