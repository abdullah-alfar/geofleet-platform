import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, Selectable } from 'kysely';
import { KYSELY_DB } from '../../database/database.module';
import { Database } from '../../database/schema';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { ListPaymentsDto } from './dto/list-payments.dto';

const PAYMENT_COLUMNS = [
  'payment_id',
  'trip_id',
  'customer_id',
  'status',
  'provider',
  'amount',
  'currency',
  'region_id',
  'created_at',
  'paid_at',
  'updated_at',
] as const;

export type PaymentRow = Pick<
  Selectable<Database['admin_payment_projection']>,
  (typeof PAYMENT_COLUMNS)[number]
>;

/**
 * `payment.requested/completed/failed.v1` have no producer in core-api
 * yet (docs/admin-api/kafka-projections.md) — this table is always empty
 * today, same honest gap as trips.service.ts. No card data is ever
 * stored here regardless — `amount`/`currency`/`provider`/`status` only,
 * matching the original spec's "do not store sensitive card data" rule.
 */
@Injectable()
export class PaymentsService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async list(filters: ListPaymentsDto): Promise<PaginatedResponse<PaymentRow>> {
    let query = this.db
      .selectFrom('admin_payment_projection')
      .select(PAYMENT_COLUMNS);

    if (filters.status) {
      query = query.where('status', '=', filters.status);
    }
    if (filters.payment_provider) {
      query = query.where('provider', '=', filters.payment_provider);
    }
    if (filters.region_id) {
      query = query.where('region_id', '=', filters.region_id);
    }
    if (filters.date_from) {
      query = query.where('created_at', '>=', new Date(filters.date_from));
    }
    if (filters.date_to) {
      query = query.where('created_at', '<=', new Date(filters.date_to));
    }
    if (filters.amount_from !== undefined) {
      query = query.where('amount', '>=', String(filters.amount_from));
    }
    if (filters.amount_to !== undefined) {
      query = query.where('amount', '<=', String(filters.amount_to));
    }

    const cursor = decodeCursor(filters.cursor);
    if (cursor) {
      query = query.where((eb) =>
        eb.or([
          eb('updated_at', '<', cursor.updatedAt),
          eb.and([
            eb('updated_at', '=', cursor.updatedAt),
            eb('payment_id', '<', cursor.id),
          ]),
        ]),
      );
    }

    const rows = await query
      .orderBy('updated_at', 'desc')
      .orderBy('payment_id', 'desc')
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
            ? encodeCursor({ updatedAt: last.updated_at, id: last.payment_id })
            : null,
      },
    };
  }

  async findOne(paymentId: string): Promise<PaymentRow> {
    const row = await this.db
      .selectFrom('admin_payment_projection')
      .select(PAYMENT_COLUMNS)
      .where('payment_id', '=', paymentId)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundException({
        code: 'payment_not_found',
        message: 'Payment was not found.',
      });
    }

    return row;
  }
}
