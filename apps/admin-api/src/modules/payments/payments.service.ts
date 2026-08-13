import { Injectable } from '@nestjs/common';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { CoreApiClientService } from '../../integrations/core-api/core-api-client.service';
import { AdminPrincipal } from '../auth/admin-principal.interface';
import { ListPaymentsDto } from './dto/list-payments.dto';

export interface PaymentRow {
  payment_id: string;
  trip_id: string | null;
  customer_id: string | null;
  status: string;
  provider: string | null;
  amount: string | null;
  currency: string | null;
  region_id: string | null;
  created_at: string | null;
  paid_at: string | null;
  updated_at: string;
}

/**
 * Calls core-api's internal/v1/payments/* directly and synchronously —
 * no local Kafka-projected read model anymore (see
 * docs/admin-api/query-apis.md). No card data is ever stored/returned
 * here regardless — `amount`/`currency`/`provider`/`status` only.
 */
@Injectable()
export class PaymentsService {
  constructor(private readonly coreApi: CoreApiClientService) {}

  list(
    filters: ListPaymentsDto,
    correlationId: string | undefined,
  ): Promise<PaginatedResponse<PaymentRow>> {
    return this.coreApi.get<PaginatedResponse<PaymentRow>>(
      '/api/internal/v1/payments',
      { ...filters },
      correlationId,
    );
  }

  findOne(
    paymentId: string,
    correlationId: string | undefined,
  ): Promise<PaymentRow> {
    return this.coreApi.get<PaymentRow>(
      `/api/internal/v1/payments/${paymentId}`,
      undefined,
      correlationId,
    );
  }

  /**
   * Forwards to core-api's internal/v1/payments/{id}/refund. No Kafka
   * event fires for this on core-api's side (no `payment.refunded.v1`
   * topic); the refund is still fully durable via core-api's
   * `payments.status` write and its `audit_logs` row.
   */
  refund(
    paymentId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.coreApi.patch(
      `/api/internal/v1/payments/${paymentId}/refund`,
      { admin_user_id: admin.userId, reason },
      correlationId,
    );
  }
}
