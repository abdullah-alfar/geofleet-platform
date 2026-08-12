import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, Selectable } from 'kysely';
import { KYSELY_DB } from '../../database/database.module';
import { Database } from '../../database/schema';
import { decodeCursor, encodeCursor } from '../../common/pagination/cursor';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { ListDriversDto } from './dto/list-drivers.dto';

const DRIVER_COLUMNS = [
  'driver_id',
  'name',
  'phone_masked',
  'status',
  'availability_status',
  'vehicle_type',
  'rating',
  'region_id',
  'last_location_at',
  'last_seen_at',
  'active_trip_id',
  'updated_at',
] as const;

// Selectable<>, not Pick<Database[...]> directly — the raw table
// interface's Generated<Date>/ColumnType<...> columns need Kysely's
// Selectable<> to resolve to their plain read type (Date), the same fix
// Phase 4's projection handlers needed for the opposite (insert) side.
export type DriverRow = Pick<
  Selectable<Database['admin_driver_projection']>,
  (typeof DRIVER_COLUMNS)[number]
>;

@Injectable()
export class DriversService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async list(filters: ListDriversDto): Promise<PaginatedResponse<DriverRow>> {
    let query = this.db
      .selectFrom('admin_driver_projection')
      .select(DRIVER_COLUMNS);

    if (filters.status) {
      query = query.where('status', '=', filters.status);
    }
    if (filters.availability_status) {
      query = query.where(
        'availability_status',
        '=',
        filters.availability_status,
      );
    }
    if (filters.vehicle_type) {
      query = query.where('vehicle_type', '=', filters.vehicle_type);
    }
    if (filters.region_id) {
      query = query.where('region_id', '=', filters.region_id);
    }
    if (filters.last_seen_from) {
      query = query.where(
        'last_seen_at',
        '>=',
        new Date(filters.last_seen_from),
      );
    }
    if (filters.last_seen_to) {
      query = query.where('last_seen_at', '<=', new Date(filters.last_seen_to));
    }
    if (filters.rating_from !== undefined) {
      query = query.where('rating', '>=', String(filters.rating_from));
    }
    if (filters.rating_to !== undefined) {
      query = query.where('rating', '<=', String(filters.rating_to));
    }
    if (filters.search) {
      query = query.where('driver_id', 'like', `${filters.search}%`);
    }

    const cursor = decodeCursor(filters.cursor);
    if (cursor) {
      query = query.where((eb) =>
        eb.or([
          eb('updated_at', '<', cursor.updatedAt),
          eb.and([
            eb('updated_at', '=', cursor.updatedAt),
            eb('driver_id', '<', cursor.id),
          ]),
        ]),
      );
    }

    const rows = await query
      .orderBy('updated_at', 'desc')
      .orderBy('driver_id', 'desc')
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
            ? encodeCursor({ updatedAt: last.updated_at, id: last.driver_id })
            : null,
      },
    };
  }

  async findOne(driverId: string): Promise<DriverRow> {
    const row = await this.db
      .selectFrom('admin_driver_projection')
      .select(DRIVER_COLUMNS)
      .where('driver_id', '=', driverId)
      .executeTakeFirst();

    if (!row) {
      throw new NotFoundException({
        code: 'driver_not_found',
        message: 'Driver was not found.',
      });
    }

    return row;
  }
}
