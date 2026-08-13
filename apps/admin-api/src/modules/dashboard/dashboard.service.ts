import { Injectable } from '@nestjs/common';
import { CoreApiClientService } from '../../integrations/core-api/core-api-client.service';

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

/**
 * Calls core-api's internal/v1/dashboard/* directly and synchronously —
 * no local Kafka-projected aggregate tables anymore (see
 * docs/admin-api/query-apis.md). core-api computes these as live COUNT
 * queries against its own indexed tables; admin traffic is low-volume
 * enough that this is simpler and more honest than maintaining a second
 * derived store for one caller.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly coreApi: CoreApiClientService) {}

  getSummary(correlationId: string | undefined): Promise<DashboardSummary> {
    return this.coreApi.get<DashboardSummary>(
      '/api/internal/v1/dashboard/summary',
      undefined,
      correlationId,
    );
  }

  getRegions(correlationId: string | undefined): Promise<RegionMetrics[]> {
    return this.coreApi.get<RegionMetrics[]>(
      '/api/internal/v1/dashboard/regions',
      undefined,
      correlationId,
    );
  }
}
