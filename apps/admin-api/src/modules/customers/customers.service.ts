import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../integrations/postgres/postgres.module';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import {
  cursorWhereFragment,
  decodeCursor,
  paginateRows,
} from '../../common/pagination/cursor';
import { applyPhoneMask } from '../../common/phone-mask';
import { ListCustomersDto } from './dto/list-customers.dto';

export interface CustomerRow {
  customer_id: string;
  name: string | null;
  email: string | null;
  phone_masked: string | null;
  status: string | null;
  region_id: string | null;
  rating: string | null;
  total_rides: number | null;
  total_trips: number | null;
  created_at: string | null;
  updated_at: string | null;
}

interface CustomerQueryRow {
  customer_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  region_id: string;
  rating: string | null;
  created_at: string;
  updated_at: string;
}

function toCustomerRow(
  row: CustomerQueryRow,
  counts: { total_rides: number | null; total_trips: number | null },
): CustomerRow {
  return {
    customer_id: row.customer_id,
    name: row.name,
    email: row.email,
    phone_masked: applyPhoneMask(row.phone),
    status: row.status,
    region_id: row.region_id,
    rating: row.rating,
    total_rides: counts.total_rides,
    total_trips: counts.total_trips,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const CUSTOMER_BASE_QUERY = `
  SELECT
    c.uuid AS customer_id,
    u.name AS name,
    u.email AS email,
    u.phone AS phone,
    u.status AS status,
    u.region_id AS region_id,
    c.rating AS rating,
    c.created_at AS created_at,
    c.updated_at AS updated_at
  FROM customers c
  JOIN users u ON u.id = c.user_id
`;

/**
 * Direct SQL against customers — ports CustomerQueryController's
 * filters/pagination and AdminCustomerResource's exact field shape,
 * including the list-vs-detail asymmetry: `total_rides`/`total_trips`
 * are only computed on the single-customer detail response (an
 * aggregate per row would be too expensive on a paginated list, same
 * reasoning core-api's own controller documents). Read-only — customers
 * have no admin write commands anywhere in this platform.
 */
@Injectable()
export class CustomersService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(
    filters: ListCustomersDto,
    correlationId: string | undefined,
  ): Promise<PaginatedResponse<CustomerRow>> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let i = 1;

    if (filters.status) {
      conditions.push(`u.status = $${i++}`);
      params.push(filters.status);
    }
    if (filters.region_id) {
      conditions.push(`u.region_id = $${i++}`);
      params.push(filters.region_id);
    }
    if (filters.search) {
      conditions.push(`u.name ILIKE $${i++}`);
      params.push(`${filters.search}%`);
    }

    const cursorFragment = cursorWhereFragment(
      decodeCursor(filters.cursor),
      'c.updated_at',
      'c.uuid',
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
    const sql = `${CUSTOMER_BASE_QUERY} ${where} ORDER BY c.updated_at DESC, c.uuid DESC LIMIT $${i}`;
    params.push(limit + 1);

    const { rows } = await this.pool.query<CustomerQueryRow>(sql, params);
    const { page, nextCursor } = paginateRows(
      rows,
      limit,
      (row) => row.updated_at,
      (row) => row.customer_id,
    );

    return {
      data: page.map((row) =>
        toCustomerRow(row, { total_rides: null, total_trips: null }),
      ),
      meta: { next_cursor: nextCursor },
    };
  }

  async findOne(
    customerId: string,
    correlationId: string | undefined,
  ): Promise<CustomerRow> {
    const { rows } = await this.pool.query<CustomerQueryRow>(
      `${CUSTOMER_BASE_QUERY} WHERE c.uuid = $1`,
      [customerId],
    );
    if (!rows[0]) {
      throw new NotFoundException({
        code: 'customer_not_found',
        message: 'No customer with that id.',
      });
    }

    const { rows: countRows } = await this.pool.query<{
      total_rides: string;
      total_trips: string;
    }>(
      `SELECT
         (SELECT count(*) FROM ride_requests WHERE customer_id = c.id) AS total_rides,
         (SELECT count(*) FROM trips WHERE customer_id = c.id) AS total_trips
       FROM customers c
       WHERE c.uuid = $1`,
      [customerId],
    );

    return toCustomerRow(rows[0], {
      total_rides: Number(countRows[0].total_rides),
      total_trips: Number(countRows[0].total_trips),
    });
  }
}
