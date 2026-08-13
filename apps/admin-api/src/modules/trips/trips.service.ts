import { Injectable } from '@nestjs/common';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { CoreApiClientService } from '../../integrations/core-api/core-api-client.service';
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

/**
 * Calls core-api's internal/v1/trips/* directly and synchronously — no
 * local Kafka-projected read model anymore (see
 * docs/admin-api/query-apis.md). `fare_amount` replaces the old
 * projection's `estimated_price`/`final_price` split — core-api's
 * `trips` table only ever had one price column (set once, at
 * completion); that split existed only in the Kafka event schema and was
 * never actually populated (trip.* events had no producer).
 */
@Injectable()
export class TripsService {
  constructor(private readonly coreApi: CoreApiClientService) {}

  list(
    filters: ListTripsDto,
    correlationId: string | undefined,
  ): Promise<PaginatedResponse<TripRow>> {
    return this.coreApi.get<PaginatedResponse<TripRow>>(
      '/api/internal/v1/trips',
      { ...filters },
      correlationId,
    );
  }

  findOne(
    tripId: string,
    correlationId: string | undefined,
  ): Promise<TripDetail> {
    return this.coreApi.get<TripDetail>(
      `/api/internal/v1/trips/${tripId}`,
      undefined,
      correlationId,
    );
  }

  /**
   * Forwards to core-api's internal/v1/trips/{id}/cancel.
   */
  cancel(
    tripId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.coreApi.patch(
      `/api/internal/v1/trips/${tripId}/cancel`,
      { admin_user_id: admin.userId, reason },
      correlationId,
    );
  }
}
