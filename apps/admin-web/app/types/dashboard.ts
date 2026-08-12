/** Mirrors apps/admin-api/src/modules/dashboard/dashboard.service.ts's
 * own DashboardSummary/RegionMetrics exactly. */
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
