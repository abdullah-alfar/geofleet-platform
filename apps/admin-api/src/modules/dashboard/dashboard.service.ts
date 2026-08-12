import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../database/database.module';
import { Database } from '../../database/schema';

/**
 * A driver counts as "online" if we've heard from them within this
 * window — same 5-minute freshness location-service's own
 * `LOCATION_TTL` default already uses for "is this driver's last known
 * position still meaningful" (apps/location-service/.env.example). Not a
 * new config knob: reusing an existing, already-reasoned-about constant
 * rather than inventing a second "recency" threshold for the same
 * underlying question.
 */
const DRIVER_ONLINE_WINDOW_MS = 5 * 60 * 1000;

export interface DashboardSummary {
  online_drivers: number;
  available_drivers: number;
  active_trips: number;
  searching_rides: number;
  rides_today: number;
  completed_trips_today: number;
  cancelled_trips_today: number;
  failed_payments_today: number;
  average_matching_time_ms: number | null;
}

export interface RegionMetrics {
  region_id: string;
  online_drivers: number;
  available_drivers: number;
  active_trips: number;
  searching_rides: number;
}

function utcDayStart(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

async function countOf(qb: {
  executeTakeFirstOrThrow: () => Promise<{ count: string | number }>;
}): Promise<number> {
  const row = await qb.executeTakeFirstOrThrow();
  return Number(row.count);
}

function blankRegion(regionId: string): RegionMetrics {
  return {
    region_id: regionId,
    online_drivers: 0,
    available_drivers: 0,
    active_trips: 0,
    searching_rides: 0,
  };
}

/**
 * Reads live aggregates from the (small, already-indexed) projection
 * tables rather than a precomputed `admin_region_metrics` row — that
 * table exists (Phase 3) but nothing writes to it (Phase 4 left its
 * update strategy undecided, see docs/admin-api/read-models.md). The
 * "don't compute the dashboard from production tables on every request"
 * philosophy the original spec describes is about avoiding
 * COUNT/JOIN-heavy queries against core-api's raw transactional tables —
 * these projection tables are already the small, denormalized,
 * purpose-built tier that philosophy asks for, so querying them directly
 * (with the indexes read-models.md documents) doesn't reintroduce the
 * problem it warns about. Revisit if these queries ever show up as slow
 * at real data volumes — that's the trigger for building the
 * precomputation this table was reserved for, not before.
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  async getSummary(): Promise<DashboardSummary> {
    const onlineSince = new Date(Date.now() - DRIVER_ONLINE_WINDOW_MS);
    const todayStart = utcDayStart();

    const [
      onlineDrivers,
      availableDrivers,
      activeTrips,
      searchingRides,
      ridesToday,
      completedTripsToday,
      cancelledTripsToday,
      failedPaymentsToday,
      averageMatchingTimeMs,
    ] = await Promise.all([
      countOf(
        this.db
          .selectFrom('admin_driver_projection')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('last_seen_at', '>=', onlineSince),
      ),
      countOf(
        this.db
          .selectFrom('admin_driver_projection')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('availability_status', '=', 'available')
          .where('last_seen_at', '>=', onlineSince),
      ),
      countOf(
        this.db
          .selectFrom('admin_trip_projection')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('status', '=', 'in_progress'),
      ),
      countOf(
        this.db
          .selectFrom('admin_ride_projection')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('status', '=', 'searching'),
      ),
      countOf(
        this.db
          .selectFrom('admin_ride_projection')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('requested_at', '>=', todayStart),
      ),
      countOf(
        this.db
          .selectFrom('admin_trip_projection')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('status', '=', 'completed')
          .where('completed_at', '>=', todayStart),
      ),
      countOf(
        this.db
          .selectFrom('admin_trip_projection')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('status', '=', 'cancelled')
          .where('cancelled_at', '>=', todayStart),
      ),
      countOf(
        this.db
          .selectFrom('admin_payment_projection')
          .select((eb) => eb.fn.countAll<string>().as('count'))
          .where('status', '=', 'failed')
          .where('created_at', '>=', todayStart),
      ),
      this.averageMatchingTimeMs(todayStart),
    ]);

    return {
      online_drivers: onlineDrivers,
      available_drivers: availableDrivers,
      active_trips: activeTrips,
      searching_rides: searchingRides,
      rides_today: ridesToday,
      completed_trips_today: completedTripsToday,
      cancelled_trips_today: cancelledTripsToday,
      failed_payments_today: failedPaymentsToday,
      average_matching_time_ms: averageMatchingTimeMs,
    };
  }

  async getRegions(): Promise<RegionMetrics[]> {
    const onlineSince = new Date(Date.now() - DRIVER_ONLINE_WINDOW_MS);

    const [driverRows, tripRows, rideRows] = await Promise.all([
      this.db
        .selectFrom('admin_driver_projection')
        .select((eb) => [
          'region_id',
          eb.fn
            .countAll<string>()
            .filterWhere('last_seen_at', '>=', onlineSince)
            .as('online_drivers'),
          eb.fn
            .countAll<string>()
            .filterWhere('availability_status', '=', 'available')
            .filterWhere('last_seen_at', '>=', onlineSince)
            .as('available_drivers'),
        ])
        .where('region_id', 'is not', null)
        .groupBy('region_id')
        .execute(),
      this.db
        .selectFrom('admin_trip_projection')
        .select((eb) => [
          'region_id',
          eb.fn.countAll<string>().as('active_trips'),
        ])
        .where('status', '=', 'in_progress')
        .where('region_id', 'is not', null)
        .groupBy('region_id')
        .execute(),
      this.db
        .selectFrom('admin_ride_projection')
        .select((eb) => [
          'region_id',
          eb.fn.countAll<string>().as('searching_rides'),
        ])
        .where('status', '=', 'searching')
        .where('region_id', 'is not', null)
        .groupBy('region_id')
        .execute(),
    ]);

    const byRegion = new Map<string, RegionMetrics>();
    for (const row of driverRows) {
      if (!row.region_id) continue;
      byRegion.set(row.region_id, {
        region_id: row.region_id,
        online_drivers: Number(row.online_drivers),
        available_drivers: Number(row.available_drivers),
        active_trips: 0,
        searching_rides: 0,
      });
    }
    for (const row of tripRows) {
      if (!row.region_id) continue;
      const entry = byRegion.get(row.region_id) ?? blankRegion(row.region_id);
      entry.active_trips = Number(row.active_trips);
      byRegion.set(row.region_id, entry);
    }
    for (const row of rideRows) {
      if (!row.region_id) continue;
      const entry = byRegion.get(row.region_id) ?? blankRegion(row.region_id);
      entry.searching_rides = Number(row.searching_rides);
      byRegion.set(row.region_id, entry);
    }

    return Array.from(byRegion.values()).sort((a, b) =>
      a.region_id.localeCompare(b.region_id),
    );
  }

  private async averageMatchingTimeMs(
    todayStart: Date,
  ): Promise<number | null> {
    const row = await this.db
      .selectFrom('admin_ride_projection')
      .select(() =>
        sql<
          string | null
        >`avg(extract(epoch from (assigned_at - requested_at)) * 1000)`.as(
          'avg_ms',
        ),
      )
      .where('assigned_at', 'is not', null)
      .where('assigned_at', '>=', todayStart)
      .executeTakeFirstOrThrow();

    return row.avg_ms !== null ? Number(row.avg_ms) : null;
  }
}
