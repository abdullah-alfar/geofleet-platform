import { Injectable } from '@nestjs/common';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { CoreApiClientService } from '../../integrations/core-api/core-api-client.service';
import { AdminPrincipal } from '../auth/admin-principal.interface';
import { ListDriversDto } from './dto/list-drivers.dto';

export interface DriverRow {
  driver_id: string;
  name: string | null;
  phone_masked: string | null;
  status: string | null;
  availability_status: string | null;
  vehicle_type: string | null;
  rating: string | null;
  region_id: string | null;
  active_trip_id: string | null;
  last_available_at: string | null;
  updated_at: string;
}

/**
 * Calls core-api's internal/v1/drivers/* directly and synchronously — no
 * local Kafka-projected read model anymore (see
 * docs/admin-api/query-apis.md). `ListDriversDto`'s field names already
 * match DriverQueryController's own filter names one-for-one, so they're
 * forwarded as-is.
 */
@Injectable()
export class DriversService {
  constructor(private readonly coreApi: CoreApiClientService) {}

  list(
    filters: ListDriversDto,
    correlationId: string | undefined,
  ): Promise<PaginatedResponse<DriverRow>> {
    return this.coreApi.get<PaginatedResponse<DriverRow>>(
      '/api/internal/v1/drivers',
      { ...filters },
      correlationId,
    );
  }

  findOne(
    driverId: string,
    correlationId: string | undefined,
  ): Promise<DriverRow> {
    return this.coreApi.get<DriverRow>(
      `/api/internal/v1/drivers/${driverId}`,
      undefined,
      correlationId,
    );
  }

  /**
   * Forwards to core-api's internal/v1/drivers/{id}/suspend — the actual
   * mutation (drivers.status, is_available, audit log, outbox event) all
   * happen there. See docs/admin-api/laravel-integration.md.
   */
  suspend(
    driverId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.forwardCommand(
      driverId,
      'suspend',
      admin,
      reason,
      correlationId,
    );
  }

  /**
   * Forwards to core-api's internal/v1/drivers/{id}/approve — the only
   * path in the platform that moves a driver out of `pending_review`.
   * See docs/admin-api/laravel-integration.md.
   */
  approve(
    driverId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.forwardCommand(
      driverId,
      'approve',
      admin,
      reason,
      correlationId,
    );
  }

  /**
   * Forwards to core-api's internal/v1/drivers/{id}/unsuspend — the
   * inverse of suspend(), restores `active` standing.
   */
  unsuspend(
    driverId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.forwardCommand(
      driverId,
      'unsuspend',
      admin,
      reason,
      correlationId,
    );
  }

  /**
   * Forwards to core-api's internal/v1/drivers/{id}/disable — a harder,
   * intended-as-more-permanent counterpart to suspend().
   */
  disable(
    driverId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.forwardCommand(
      driverId,
      'disable',
      admin,
      reason,
      correlationId,
    );
  }

  /** All four driver commands share this exact request shape — only the
   * path segment differs. */
  private forwardCommand(
    driverId: string,
    action: 'approve' | 'suspend' | 'unsuspend' | 'disable',
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.coreApi.patch(
      `/api/internal/v1/drivers/${driverId}/${action}`,
      { admin_user_id: admin.userId, reason },
      correlationId,
    );
  }
}
