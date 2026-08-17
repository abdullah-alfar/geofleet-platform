import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../../integrations/postgres/postgres.module';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import {
  cursorWhereFragment,
  decodeCursor,
  paginateRows,
} from '../../common/pagination/cursor';
import { resolveAdminId } from '../../common/resolve-admin-id';
import { AdminPrincipal } from '../auth/admin-principal.interface';
import { ListTripsDto } from './dto/list-trips.dto';

export interface TripRow {
  trip_id: string;
  customer_id: string | null;
  driver_id: string | null;
  region_id: string | null;
  status: string;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  dropoff_latitude: number | null;
  dropoff_longitude: number | null;
  distance_meters: string | null;
  duration_seconds: number | null;
  fare_amount: string | null;
  currency: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
}

export interface TripMilestone {
  event: string;
  at: string;
}

export interface TripDetail extends TripRow {
  timeline: TripMilestone[];
}

const TRIP_BASE_QUERY = `
  SELECT
    t.uuid AS trip_id,
    c.uuid AS customer_id,
    d.uuid AS driver_id,
    t.region_id AS region_id,
    t.status AS status,
    ST_Y(t.pickup_location::geometry) AS pickup_latitude,
    ST_X(t.pickup_location::geometry) AS pickup_longitude,
    ST_Y(t.dropoff_location::geometry) AS dropoff_latitude,
    ST_X(t.dropoff_location::geometry) AS dropoff_longitude,
    t.distance_meters AS distance_meters,
    t.duration_seconds AS duration_seconds,
    t.fare_amount AS fare_amount,
    t.currency AS currency,
    t.started_at AS started_at,
    t.completed_at AS completed_at,
    t.cancelled_at AS cancelled_at,
    t.updated_at AS updated_at
  FROM trips t
  JOIN customers c ON c.id = t.customer_id
  LEFT JOIN drivers d ON d.id = t.driver_id
`;

function buildTimeline(row: TripRow): TripMilestone[] {
  const milestones: TripMilestone[] = [];
  if (row.started_at) milestones.push({ event: 'started', at: row.started_at });
  if (row.completed_at) milestones.push({ event: 'completed', at: row.completed_at });
  if (row.cancelled_at) milestones.push({ event: 'cancelled', at: row.cancelled_at });
  return milestones.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/**
 * Direct SQL against trips — ports TripQueryController's filters/
 * pagination and AdminTripResource's exact field shape, plus
 * TripCommandController::cancel() (state guard, outbox insert, audit
 * insert, in one transaction — see
 * docs/decisions/0011-admin-api-independent-service.md).
 */
@Injectable()
export class TripsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(
    filters: ListTripsDto,
    correlationId: string | undefined,
  ): Promise<PaginatedResponse<TripRow>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (filters.status) {
      conditions.push(`t.status = $${i++}`);
      params.push(filters.status);
    }
    if (filters.region_id) {
      conditions.push(`t.region_id = $${i++}`);
      params.push(filters.region_id);
    }
    if (filters.driver_id) {
      conditions.push(`d.uuid = $${i++}`);
      params.push(filters.driver_id);
    }
    if (filters.customer_id) {
      conditions.push(`c.uuid = $${i++}`);
      params.push(filters.customer_id);
    }
    if (filters.date_from) {
      conditions.push(`t.started_at >= $${i++}`);
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      conditions.push(`t.started_at <= $${i++}`);
      params.push(filters.date_to);
    }
    if (filters.minimum_price !== undefined) {
      conditions.push(`t.fare_amount >= $${i++}`);
      params.push(filters.minimum_price);
    }
    if (filters.maximum_price !== undefined) {
      conditions.push(`t.fare_amount <= $${i++}`);
      params.push(filters.maximum_price);
    }

    const oldest = filters.order === 'oldest';
    const orderColumn = oldest ? 'started_at' : 'updated_at';
    const direction = oldest ? 'asc' : 'desc';

    const cursorFragment = cursorWhereFragment(
      decodeCursor(filters.cursor),
      `t.${orderColumn}`,
      't.uuid',
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
    const sql = `${TRIP_BASE_QUERY} ${where} ORDER BY t.${orderColumn} ${direction}, t.uuid ${direction} LIMIT $${i}`;
    params.push(limit + 1);

    const { rows } = await this.pool.query<TripRow>(sql, params);
    const { page, nextCursor } = paginateRows(
      rows,
      limit,
      (row) => row[orderColumn as 'started_at' | 'updated_at'] ?? '',
      (row) => row.trip_id,
    );

    return { data: page, meta: { next_cursor: nextCursor } };
  }

  async findOne(
    tripId: string,
    correlationId: string | undefined,
  ): Promise<TripDetail> {
    const { rows } = await this.pool.query<TripRow>(
      `${TRIP_BASE_QUERY} WHERE t.uuid = $1`,
      [tripId],
    );
    if (!rows[0]) {
      throw new NotFoundException({
        code: 'trip_not_found',
        message: 'No trip with that id.',
      });
    }
    return { ...rows[0], timeline: buildTimeline(rows[0]) };
  }

  /**
   * Ports TripCommandController::cancel() exactly: guard on
   * status = 'in_progress', sets cancelled_at/cancellation_reason,
   * publishes trip.cancelled.v1 via the outbox, writes an audit row.
   */
  async cancel(
    tripId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const adminId = await resolveAdminId(client, admin.userId);

      const { rows: updated } = await client.query<{
        id: number;
        uuid: string;
        region_id: string;
        status: string;
      }>(
        `UPDATE trips SET status = 'cancelled', cancelled_at = now(), cancellation_reason = $1
         WHERE uuid = $2 AND status = 'in_progress'
         RETURNING id, uuid, region_id, status`,
        [reason ?? null, tripId],
      );

      if (updated.length === 0) {
        await client.query('ROLLBACK');
        throw new ConflictException({
          code: 'trip_transition_conflict',
          message: 'Trip is not in a state this action can apply to.',
        });
      }

      const trip = updated[0];

      await client.query(
        `INSERT INTO outbox_events
           (event_id, aggregate_type, aggregate_id, event_type, event_version, payload, headers, occurred_at)
         VALUES ($1, 'trip', $2, 'trip.cancelled', 1, $3, $4, now())`,
        [
          randomUUID(),
          trip.uuid,
          JSON.stringify({
            event_id: randomUUID(),
            event_type: 'trip.cancelled',
            event_version: 1,
            occurred_at: new Date().toISOString(),
            producer: 'admin-api',
            correlation_id: correlationId ?? randomUUID(),
            causation_id: null,
            aggregate_type: 'trip',
            aggregate_id: trip.uuid,
            region_id: trip.region_id,
            data: { trip_id: trip.uuid, reason: reason ?? null },
          }),
          JSON.stringify({ correlation_id: correlationId ?? null }),
        ],
      );

      await client.query(
        `INSERT INTO audit_logs
           (uuid, actor_type, actor_id, action, auditable_type, auditable_id, changes, region_id, occurred_at)
         VALUES ($1, 'admin', $2, 'trip.cancelled', 'trip', $3, $4, $5, now())`,
        [
          randomUUID(),
          adminId,
          trip.id,
          JSON.stringify({
            status: { from: 'in_progress', to: 'cancelled' },
            reason: reason ?? null,
          }),
          trip.region_id,
        ],
      );

      await client.query('COMMIT');
      return { status: trip.status, trip_id: trip.uuid };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
