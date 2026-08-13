import { Injectable } from '@nestjs/common';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { CoreApiClientService } from '../../integrations/core-api/core-api-client.service';
import { ListRidesDto } from './dto/list-rides.dto';

export interface RideRow {
  ride_request_id: string;
  customer_id: string | null;
  driver_id: string | null;
  region_id: string | null;
  status: string;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  dropoff_latitude: number | null;
  dropoff_longitude: number | null;
  requested_at: string | null;
  accepted_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
}

export interface RideMilestone {
  event: string;
  at: string;
}

export interface RideDetail extends RideRow {
  timeline: RideMilestone[];
}

export interface RideOfferSummary {
  offer_id: string;
  ride_request_id: string;
  driver_id: string;
  status: string;
  created_at: string | null;
  expires_at: string | null;
  responded_at: string | null;
  updated_at: string;
  is_expired: boolean;
}

/**
 * Calls core-api's internal/v1/rides/* directly and synchronously — no
 * local Kafka-projected read model anymore (see
 * docs/admin-api/query-apis.md). `search_started_at`/`assigned_at`/
 * `unavailable_at` no longer exist as separate fields — those were
 * distinct Kafka event timestamps with no real-table equivalent; the
 * timeline core-api now returns is built from ride_requests' own
 * requested_at/accepted_at/cancelled_at columns instead.
 */
@Injectable()
export class RidesService {
  constructor(private readonly coreApi: CoreApiClientService) {}

  list(
    filters: ListRidesDto,
    correlationId: string | undefined,
  ): Promise<PaginatedResponse<RideRow>> {
    return this.coreApi.get<PaginatedResponse<RideRow>>(
      '/api/internal/v1/rides',
      { ...filters },
      correlationId,
    );
  }

  findOne(
    rideRequestId: string,
    correlationId: string | undefined,
  ): Promise<RideDetail> {
    return this.coreApi.get<RideDetail>(
      `/api/internal/v1/rides/${rideRequestId}`,
      undefined,
      correlationId,
    );
  }

  listOffers(
    rideRequestId: string,
    correlationId: string | undefined,
  ): Promise<RideOfferSummary[]> {
    return this.coreApi.get<{ data: RideOfferSummary[] }>(
      `/api/internal/v1/rides/${rideRequestId}/offers`,
      undefined,
      correlationId,
    ).then((response) => response.data);
  }
}
