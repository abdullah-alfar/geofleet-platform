import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../integrations/postgres/postgres.module';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import {
  cursorWhereFragment,
  decodeCursor,
  paginateRows,
} from '../../common/pagination/cursor';
import { ListRidesDto } from './dto/list-rides.dto';

export interface RideRow {
  ride_request_id: string;
  customer_id: string | null;
  driver_id: string | null;
  region_id: string | null;
  status: string;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  dropoff_latitude: number | null;
  dropoff_longitude: number | null;
  requested_at: string | null;
  accepted_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
}

export interface RideMilestone {
  event: string;
  at: string;
}

export interface RideDetail extends RideRow {
  timeline: RideMilestone[];
}

export interface RideOfferSummary {
  offer_id: string;
  ride_request_id: string;
  driver_id: string;
  status: string;
  created_at: string | null;
  expires_at: string | null;
  responded_at: string | null;
  updated_at: string;
  is_expired: boolean;
}

const RIDE_BASE_QUERY = `
  SELECT
    rr.uuid AS ride_request_id,
    c.uuid AS customer_id,
    d.uuid AS driver_id,
    rr.region_id AS region_id,
    rr.status AS status,
    ST_Y(rr.pickup_location::geometry) AS pickup_latitude,
    ST_X(rr.pickup_location::geometry) AS pickup_longitude,
    ST_Y(rr.dropoff_location::geometry) AS dropoff_latitude,
    ST_X(rr.dropoff_location::geometry) AS dropoff_longitude,
    rr.requested_at AS requested_at,
    rr.accepted_at AS accepted_at,
    rr.cancelled_at AS cancelled_at,
    rr.updated_at AS updated_at
  FROM ride_requests rr
  JOIN customers c ON c.id = rr.customer_id
  LEFT JOIN drivers d ON d.id = rr.driver_id
`;

function buildTimeline(row: RideRow): RideMilestone[] {
  const milestones: RideMilestone[] = [];
  if (row.requested_at) milestones.push({ event: 'requested', at: row.requested_at });
  if (row.accepted_at) milestones.push({ event: 'accepted', at: row.accepted_at });
  if (row.cancelled_at) milestones.push({ event: 'cancelled', at: row.cancelled_at });
  // `at` is typed `string` (the API contract) but `pg` actually hands
  // back a `Date` for timestamptz columns at runtime — JSON.stringify
  // serializes that to the same ISO string automatically, but comparing
  // it here needs Date's own ordering, not a string method.
  return milestones.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/**
 * Direct SQL against ride_requests/ride_offers — ports
 * RideQueryController's filters/pagination and AdminRideResource/
 * AdminRideOfferResource's exact field shapes (see
 * docs/decisions/0011-admin-api-independent-service.md). Read-only — no
 * write commands exist for rides anywhere in this platform, core-api
 * included.
 */
@Injectable()
export class RidesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(
    filters: ListRidesDto,
    correlationId: string | undefined,
  ): Promise<PaginatedResponse<RideRow>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (filters.status) {
      conditions.push(`rr.status = $${i++}`);
      params.push(filters.status);
    }
    if (filters.region_id) {
      conditions.push(`rr.region_id = $${i++}`);
      params.push(filters.region_id);
    }
    if (filters.customer_id) {
      conditions.push(`c.uuid = $${i++}`);
      params.push(filters.customer_id);
    }
    if (filters.driver_id) {
      conditions.push(`d.uuid = $${i++}`);
      params.push(filters.driver_id);
    }
    if (filters.date_from) {
      conditions.push(`rr.requested_at >= $${i++}`);
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      conditions.push(`rr.requested_at <= $${i++}`);
      params.push(filters.date_to);
    }

    const oldest = filters.order === 'oldest';
    const orderColumn = oldest ? 'requested_at' : 'updated_at';
    const direction = oldest ? 'asc' : 'desc';

    const cursorFragment = cursorWhereFragment(
      decodeCursor(filters.cursor),
      `rr.${orderColumn}`,
      'rr.uuid',
      direction,
      i,
    );
    if (cursorFragment) {
      conditions.push(cursorFragment.sql);
      params.push(...cursorFragment.params);
      i += 2;
    }

    const limit = filters.limit ?? 20;
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `${RIDE_BASE_QUERY} ${where} ORDER BY rr.${orderColumn} ${direction}, rr.uuid ${direction} LIMIT $${i}`;
    params.push(limit + 1);

    const { rows } = await this.pool.query<RideRow>(sql, params);
    const { page, nextCursor } = paginateRows(
      rows,
      limit,
      (row) => row[orderColumn as 'requested_at' | 'updated_at'] ?? '',
      (row) => row.ride_request_id,
    );

    return { data: page, meta: { next_cursor: nextCursor } };
  }

  async findOne(
    rideRequestId: string,
    correlationId: string | undefined,
  ): Promise<RideDetail> {
    const { rows } = await this.pool.query<RideRow>(
      `${RIDE_BASE_QUERY} WHERE rr.uuid = $1`,
      [rideRequestId],
    );
    if (!rows[0]) {
      throw new NotFoundException({
        code: 'ride_request_not_found',
        message: 'No ride request with that id.',
      });
    }
    return { ...rows[0], timeline: buildTimeline(rows[0]) };
  }

  async listOffers(
    rideRequestId: string,
    correlationId: string | undefined,
  ): Promise<RideOfferSummary[]> {
    const { rows: rideRows } = await this.pool.query<{ id: number }>(
      `SELECT id FROM ride_requests WHERE uuid = $1`,
      [rideRequestId],
    );
    if (!rideRows[0]) {
      throw new NotFoundException({
        code: 'ride_request_not_found',
        message: 'No ride request with that id.',
      });
    }

    const { rows } = await this.pool.query<RideOfferSummary>(
      `SELECT
         o.uuid AS offer_id,
         rr.uuid AS ride_request_id,
         d.uuid AS driver_id,
         o.status AS status,
         o.offered_at AS created_at,
         o.expires_at AS expires_at,
         o.responded_at AS responded_at,
         o.updated_at AS updated_at,
         (o.status = 'pending' AND o.expires_at IS NOT NULL AND o.expires_at < now()) AS is_expired
       FROM ride_offers o
       JOIN ride_requests rr ON rr.id = o.ride_request_id
       JOIN drivers d ON d.id = o.driver_id
       WHERE rr.uuid = $1
       ORDER BY o.offered_at ASC
       LIMIT 100`,
      [rideRequestId],
    );
    return rows;
  }
}
