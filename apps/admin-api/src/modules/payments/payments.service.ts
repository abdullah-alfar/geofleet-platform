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
import { ListPaymentsDto } from './dto/list-payments.dto';

export interface PaymentRow {
  payment_id: string;
  trip_id: string | null;
  customer_id: string | null;
  status: string;
  provider: string | null;
  amount: string | null;
  currency: string | null;
  region_id: string | null;
  created_at: string | null;
  paid_at: string | null;
  updated_at: string;
}

const PAYMENT_BASE_QUERY = `
  SELECT
    p.uuid AS payment_id,
    t.uuid AS trip_id,
    c.uuid AS customer_id,
    p.status AS status,
    p.provider AS provider,
    p.amount AS amount,
    p.currency AS currency,
    t.region_id AS region_id,
    p.created_at AS created_at,
    p.paid_at AS paid_at,
    p.updated_at AS updated_at
  FROM payments p
  JOIN trips t ON t.id = p.trip_id
  JOIN customers c ON c.id = p.customer_id
`;

/**
 * Direct SQL against payments — ports PaymentQueryController's filters/
 * pagination and AdminPaymentResource's exact field shape (including
 * `region_id`, derived from the related trip, not a payments column),
 * plus PaymentCommandController::refund() (state guard, audit insert —
 * no outbox insert, core-api's own controller doesn't publish one either
 * since no `payment.refunded.v1` topic exists in the catalog. See
 * docs/decisions/0011-admin-api-independent-service.md.
 */
@Injectable()
export class PaymentsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(
    filters: ListPaymentsDto,
    correlationId: string | undefined,
  ): Promise<PaginatedResponse<PaymentRow>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (filters.status) {
      conditions.push(`p.status = $${i++}`);
      params.push(filters.status);
    }
    if (filters.payment_provider) {
      conditions.push(`p.provider = $${i++}`);
      params.push(filters.payment_provider);
    }
    if (filters.region_id) {
      conditions.push(`t.region_id = $${i++}`);
      params.push(filters.region_id);
    }
    if (filters.date_from) {
      conditions.push(`p.created_at >= $${i++}`);
      params.push(filters.date_from);
    }
    if (filters.date_to) {
      conditions.push(`p.created_at <= $${i++}`);
      params.push(filters.date_to);
    }
    if (filters.amount_from !== undefined) {
      conditions.push(`p.amount >= $${i++}`);
      params.push(filters.amount_from);
    }
    if (filters.amount_to !== undefined) {
      conditions.push(`p.amount <= $${i++}`);
      params.push(filters.amount_to);
    }

    const cursorFragment = cursorWhereFragment(
      decodeCursor(filters.cursor),
      'p.updated_at',
      'p.uuid',
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
    const sql = `${PAYMENT_BASE_QUERY} ${where} ORDER BY p.updated_at DESC, p.uuid DESC LIMIT $${i}`;
    params.push(limit + 1);

    const { rows } = await this.pool.query<PaymentRow>(sql, params);
    const { page, nextCursor } = paginateRows(
      rows,
      limit,
      (row) => row.updated_at,
      (row) => row.payment_id,
    );

    return { data: page, meta: { next_cursor: nextCursor } };
  }

  async findOne(
    paymentId: string,
    correlationId: string | undefined,
  ): Promise<PaymentRow> {
    const { rows } = await this.pool.query<PaymentRow>(
      `${PAYMENT_BASE_QUERY} WHERE p.uuid = $1`,
      [paymentId],
    );
    if (!rows[0]) {
      throw new NotFoundException({
        code: 'payment_not_found',
        message: 'No payment with that id.',
      });
    }
    return rows[0];
  }

  /**
   * Ports PaymentCommandController::refund() exactly: guard on
   * status = 'completed', audit row only — deliberately no outbox
   * insert (core-api's own controller doesn't publish one either).
   */
  async refund(
    paymentId: string,
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
        status: string;
        trip_id: number;
      }>(
        `UPDATE payments SET status = 'refunded'
         WHERE uuid = $1 AND status = 'completed'
         RETURNING id, uuid, status, trip_id`,
        [paymentId],
      );

      if (updated.length === 0) {
        await client.query('ROLLBACK');
        throw new ConflictException({
          code: 'payment_transition_conflict',
          message: 'Payment is not in a state this action can apply to.',
        });
      }

      const payment = updated[0];

      const { rows: tripRows } = await client.query<{ region_id: string }>(
        `SELECT region_id FROM trips WHERE id = $1`,
        [payment.trip_id],
      );

      await client.query(
        `INSERT INTO audit_logs
           (uuid, actor_type, actor_id, action, auditable_type, auditable_id, changes, region_id, occurred_at)
         VALUES ($1, 'admin', $2, 'payment.refunded', 'payment', $3, $4, $5, now())`,
        [
          randomUUID(),
          adminId,
          payment.id,
          JSON.stringify({
            status: { from: 'completed', to: 'refunded' },
            reason: reason ?? null,
          }),
          tripRows[0]?.region_id ?? null,
        ],
      );

      await client.query('COMMIT');
      return { status: payment.status, payment_id: payment.uuid };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
