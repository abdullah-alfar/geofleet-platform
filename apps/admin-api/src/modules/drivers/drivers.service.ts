import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../integrations/postgres/postgres.module';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import {
  cursorWhereFragment,
  decodeCursor,
  paginateRows,
} from '../../common/pagination/cursor';
import { applyPhoneMask } from '../../common/phone-mask';
import { resolveAdminId } from '../../common/resolve-admin-id';
import { AdminPrincipal } from '../auth/admin-principal.interface';
import { ListDriversDto } from './dto/list-drivers.dto';

export interface DriverRow {
  driver_id: string;
  name: string | null;
  phone_masked: string | null;
  status: string | null;
  availability_status: string | null;
  vehicle_type: string | null;
  rating: string | null;
  region_id: string | null;
  active_trip_id: string | null;
  last_available_at: string | null;
  updated_at: string;
}

interface DriverQueryRow {
  driver_id: string;
  name: string | null;
  phone: string | null;
  status: string;
  is_available: boolean;
  vehicle_type: string | null;
  rating: string | null;
  region_id: string;
  active_trip_id: string | null;
  last_available_at: string | null;
  updated_at: string;
}

function toDriverRow(row: DriverQueryRow): DriverRow {
  return {
    driver_id: row.driver_id,
    name: row.name,
    phone_masked: applyPhoneMask(row.phone),
    status: row.status,
    availability_status: row.is_available ? 'available' : 'unavailable',
    vehicle_type: row.vehicle_type,
    rating: row.rating,
    region_id: row.region_id,
    active_trip_id: row.active_trip_id,
    last_available_at: row.last_available_at,
    updated_at: row.updated_at,
  };
}

const DRIVER_BASE_QUERY = `
  SELECT
    d.uuid AS driver_id,
    u.name AS name,
    u.phone AS phone,
    d.status AS status,
    d.is_available AS is_available,
    v.vehicle_type AS vehicle_type,
    d.rating AS rating,
    d.region_id AS region_id,
    t.uuid::text AS active_trip_id,
    d.last_available_at AS last_available_at,
    d.updated_at AS updated_at
  FROM drivers d
  JOIN users u ON u.id = d.user_id
  LEFT JOIN vehicles v ON v.driver_id = d.id AND v.is_active = true
  LEFT JOIN trips t ON t.driver_id = d.id AND t.status = 'in_progress'
`;

/**
 * Direct SQL against core-api's own tables — no more calling core-api's
 * internal/v1/drivers/* (see docs/decisions/0011-admin-api-independent-
 * service.md). Ports DriverQueryController::index()/show() (filters,
 * cursor pagination — see common/pagination/cursor.ts) and
 * AdminDriverResource's exact field shape, plus DriverCommandController's
 * approve/suspend/unsuspend/disable (state guard, outbox insert, audit
 * insert, all in one transaction — replicated exactly, see
 * apps/core-api/app/Http/Controllers/Api/Internal/V1/DriverCommandController.php).
 */
@Injectable()
export class DriversService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(
    filters: ListDriversDto,
    correlationId: string | undefined,
  ): Promise<PaginatedResponse<DriverRow>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (filters.status) {
      conditions.push(`d.status = $${i++}`);
      params.push(filters.status);
    }
    if (filters.availability_status) {
      conditions.push(`d.is_available = $${i++}`);
      params.push(filters.availability_status === 'available');
    }
    if (filters.vehicle_type) {
      conditions.push(`v.vehicle_type = $${i++}`);
      params.push(filters.vehicle_type);
    }
    if (filters.region_id) {
      conditions.push(`d.region_id = $${i++}`);
      params.push(filters.region_id);
    }
    if (filters.last_seen_from) {
      conditions.push(`d.last_available_at >= $${i++}`);
      params.push(filters.last_seen_from);
    }
    if (filters.last_seen_to) {
      conditions.push(`d.last_available_at <= $${i++}`);
      params.push(filters.last_seen_to);
    }
    if (filters.rating_from !== undefined) {
      conditions.push(`d.rating >= $${i++}`);
      params.push(filters.rating_from);
    }
    if (filters.rating_to !== undefined) {
      conditions.push(`d.rating <= $${i++}`);
      params.push(filters.rating_to);
    }
    if (filters.search) {
      conditions.push(`u.name ILIKE $${i++}`);
      params.push(`${filters.search}%`);
    }

    const cursorFragment = cursorWhereFragment(
      decodeCursor(filters.cursor),
      'd.updated_at',
      'd.uuid',
      'desc',
      i,
    );
    if (cursorFragment) {
      conditions.push(cursorFragment.sql);
      params.push(...cursorFragment.params);
      i += 2;
    }

    const limit = filters.limit ?? 20;
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sql = `${DRIVER_BASE_QUERY} ${where} ORDER BY d.updated_at DESC, d.uuid DESC LIMIT $${i}`;
    params.push(limit + 1);

    const { rows } = await this.pool.query<DriverQueryRow>(sql, params);
    const { page, nextCursor } = paginateRows(
      rows,
      limit,
      (row) => row.updated_at,
      (row) => row.driver_id,
    );

    return { data: page.map(toDriverRow), meta: { next_cursor: nextCursor } };
  }

  async findOne(
    driverId: string,
    correlationId: string | undefined,
  ): Promise<DriverRow> {
    const { rows } = await this.pool.query<DriverQueryRow>(
      `${DRIVER_BASE_QUERY} WHERE d.uuid = $1`,
      [driverId],
    );
    if (!rows[0]) {
      throw new NotFoundException({
        code: 'driver_not_found',
        message: 'No driver with that id.',
      });
    }
    return toDriverRow(rows[0]);
  }

  approve(
    driverId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.transition(driverId, admin, reason, correlationId, {
      guardStatus: 'pending_review',
      targetStatus: 'active',
      idempotentNoOp: false,
      action: 'driver.approved',
      touchAvailability: false,
    });
  }

  suspend(
    driverId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.transition(driverId, admin, reason, correlationId, {
      guardStatus: null,
      targetStatus: 'suspended',
      idempotentNoOp: true,
      action: 'driver.suspended',
      touchAvailability: true,
    });
  }

  unsuspend(
    driverId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.transition(driverId, admin, reason, correlationId, {
      guardStatus: 'suspended',
      targetStatus: 'active',
      idempotentNoOp: false,
      action: 'driver.unsuspended',
      touchAvailability: false,
    });
  }

  disable(
    driverId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.transition(driverId, admin, reason, correlationId, {
      guardStatus: null,
      targetStatus: 'disabled',
      idempotentNoOp: true,
      action: 'driver.disabled',
      touchAvailability: true,
    });
  }

  /**
   * Ports DriverCommandController::approve()/setInactiveStatus()/
   * unsuspend() into one shared shape: a conditional UPDATE (the guard),
   * an outbox insert (driver.status.changed.v1 — picked up by core-api's
   * existing, unmodified `outbox:publish` loop, see
   * app/Console/Commands/PublishOutboxEvents.php), and an audit insert,
   * all in one transaction.
   *
   * - `guardStatus` set (approve/unsuspend): non-idempotent — 0 rows
   *   affected is a 409, matching core-api's strict guard.
   * - `guardStatus` null (suspend/disable): idempotent — guards only on
   *   "not already the target status"; 0 rows affected is a silent
   *   no-op (no event, no audit), matching setInactiveStatus()'s guard.
   */
  private async transition(
    driverId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
    opts: {
      guardStatus: string | null;
      targetStatus: string;
      idempotentNoOp: boolean;
      action: string;
      touchAvailability: boolean;
    },
  ): Promise<Record<string, unknown>> {
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const adminId = await resolveAdminId(client, admin.userId);

      const updateSql = opts.touchAvailability
        ? `UPDATE drivers SET status = $1, is_available = false
           WHERE uuid = $2 AND status ${opts.guardStatus ? '= $3' : '!= $1'}
           RETURNING id, uuid, region_id, is_available, status`
        : `UPDATE drivers SET status = $1
           WHERE uuid = $2 AND status ${opts.guardStatus ? '= $3' : '!= $1'}
           RETURNING id, uuid, region_id, is_available, status`;
      const updateParams = opts.guardStatus
        ? [opts.targetStatus, driverId, opts.guardStatus]
        : [opts.targetStatus, driverId];

      // Capture the pre-update status for the audit "from" value —
      // needed before the guard's own WHERE clause makes it unrecoverable
      // from the UPDATE...RETURNING alone.
      const { rows: beforeRows } = await client.query<{ status: string }>(
        `SELECT status FROM drivers WHERE uuid = $1`,
        [driverId],
      );
      const previousStatus = beforeRows[0]?.status ?? null;

      const { rows: updated } = await client.query<{
        id: number;
        uuid: string;
        region_id: string;
        is_available: boolean;
        status: string;
      }>(updateSql, updateParams);

      if (updated.length === 0) {
        await client.query('ROLLBACK');
        if (opts.idempotentNoOp) {
          // Already in the target state (or the row doesn't exist) —
          // resolved by something else concurrently, not our event to
          // publish. Matches setInactiveStatus()'s early-return.
          return { status: opts.targetStatus, driver_id: driverId };
        }
        throw new ConflictException({
          code: 'driver_transition_conflict',
          message: `Driver is not in a state this action can apply to.`,
        });
      }

      const driver = updated[0];

      await client.query(
        `INSERT INTO outbox_events
           (event_id, aggregate_type, aggregate_id, event_type, event_version, payload, headers, occurred_at)
         VALUES ($1, 'driver', $2, 'driver.status.changed', 1, $3, $4, now())`,
        [
          randomUUID(),
          driver.uuid,
          JSON.stringify({
            event_id: randomUUID(),
            event_type: 'driver.status.changed',
            event_version: 1,
            occurred_at: new Date().toISOString(),
            producer: 'admin-api',
            correlation_id: correlationId ?? randomUUID(),
            causation_id: null,
            aggregate_type: 'driver',
            aggregate_id: driver.uuid,
            region_id: driver.region_id,
            data: {
              driver_id: driver.uuid,
              is_available: driver.is_available,
              status: driver.status,
            },
          }),
          JSON.stringify({ correlation_id: correlationId ?? null }),
        ],
      );

      await client.query(
        `INSERT INTO audit_logs
           (uuid, actor_type, actor_id, action, auditable_type, auditable_id, changes, region_id, occurred_at)
         VALUES ($1, 'admin', $2, $3, 'driver', $4, $5, $6, now())`,
        [
          randomUUID(),
          adminId,
          opts.action,
          driver.id,
          JSON.stringify({
            status: { from: previousStatus, to: driver.status },
            reason: reason ?? null,
          }),
          driver.region_id,
        ],
      );

      await client.query('COMMIT');
      return { status: driver.status, driver_id: driver.uuid };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
