import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../../integrations/postgres/postgres.module';

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

function utcStartOfToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

async function count(pool: Pool, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(sql, params);
  return Number(rows[0].count);
}

/**
 * Direct SQL against core-api's own tables — live COUNT queries, not a
 * derived aggregate store (same reasoning DashboardQueryController's own
 * doc comment gives: admin traffic is low-volume enough that this is
 * simpler and more honest than maintaining a second read model for one
 * caller). Ports summary()/regions()/averageMatchingTimeMs() exactly —
 * see docs/decisions/0011-admin-api-independent-service.md.
 *
 * `online_drivers` means "approved and in the fleet" (status='active'),
 * distinct from `available_drivers` (is_available=true, actively
 * looking for rides right now) — both real core-api concepts, neither a
 * location-service heartbeat (core-api has no heartbeat table).
 */
@Injectable()
export class DashboardService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async getSummary(correlationId: string | undefined): Promise<DashboardSummary> {
    const todayStart = utcStartOfToday();

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
      count(this.pool, `SELECT count(*) FROM drivers WHERE status = 'active'`, []),
      count(this.pool, `SELECT count(*) FROM drivers WHERE is_available = true`, []),
      count(this.pool, `SELECT count(*) FROM trips WHERE status = 'in_progress'`, []),
      count(this.pool, `SELECT count(*) FROM ride_requests WHERE status = 'searching'`, []),
      count(this.pool, `SELECT count(*) FROM ride_requests WHERE requested_at >= $1`, [todayStart]),
      count(
        this.pool,
        `SELECT count(*) FROM trips WHERE status = 'completed' AND completed_at >= $1`,
        [todayStart],
      ),
      count(
        this.pool,
        `SELECT count(*) FROM trips WHERE status = 'cancelled' AND cancelled_at >= $1`,
        [todayStart],
      ),
      count(
        this.pool,
        `SELECT count(*) FROM payments WHERE status = 'failed' AND created_at >= $1`,
        [todayStart],
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

  async getRegions(correlationId: string | undefined): Promise<RegionMetrics[]> {
    const byRegion = new Map<string, RegionMetrics>();
    const blank = (regionId: string): RegionMetrics => ({
      region_id: regionId,
      online_drivers: 0,
      available_drivers: 0,
      active_trips: 0,
      searching_rides: 0,
    });

    const { rows: driverRows } = await this.pool.query<{
      region_id: string;
      online_drivers: string;
      available_drivers: string;
    }>(
      `SELECT region_id,
              count(*) filter (where status = 'active') AS online_drivers,
              count(*) filter (where is_available = true) AS available_drivers
       FROM drivers
       WHERE region_id IS NOT NULL
       GROUP BY region_id`,
    );
    for (const row of driverRows) {
      byRegion.set(row.region_id, {
        ...blank(row.region_id),
        online_drivers: Number(row.online_drivers),
        available_drivers: Number(row.available_drivers),
      });
    }

    const { rows: tripRows } = await this.pool.query<{
      region_id: string;
      active_trips: string;
    }>(
      `SELECT region_id, count(*) AS active_trips
       FROM trips
       WHERE region_id IS NOT NULL AND status = 'in_progress'
       GROUP BY region_id`,
    );
    for (const row of tripRows) {
      const existing = byRegion.get(row.region_id) ?? blank(row.region_id);
      byRegion.set(row.region_id, {
        ...existing,
        active_trips: Number(row.active_trips),
      });
    }

    const { rows: rideRows } = await this.pool.query<{
      region_id: string;
      searching_rides: string;
    }>(
      `SELECT region_id, count(*) AS searching_rides
       FROM ride_requests
       WHERE region_id IS NOT NULL AND status = 'searching'
       GROUP BY region_id`,
    );
    for (const row of rideRows) {
      const existing = byRegion.get(row.region_id) ?? blank(row.region_id);
      byRegion.set(row.region_id, {
        ...existing,
        searching_rides: Number(row.searching_rides),
      });
    }

    return [...byRegion.values()].sort((a, b) => a.region_id.localeCompare(b.region_id));
  }

  private async averageMatchingTimeMs(todayStart: Date): Promise<number | null> {
    const { rows } = await this.pool.query<{ avg_ms: string | null }>(
      `SELECT avg(extract(epoch from (accepted_at - requested_at)) * 1000) AS avg_ms
       FROM ride_requests
       WHERE accepted_at IS NOT NULL AND accepted_at >= $1`,
      [todayStart],
    );
    return rows[0]?.avg_ms !== null && rows[0]?.avg_ms !== undefined
      ? Number(rows[0].avg_ms)
      : null;
  }
}
