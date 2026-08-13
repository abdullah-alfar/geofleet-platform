import { Injectable } from '@nestjs/common';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { CoreApiClientService } from '../../integrations/core-api/core-api-client.service';
import { ListCustomersDto } from './dto/list-customers.dto';

export interface CustomerRow {
  customer_id: string;
  name: string | null;
  email: string | null;
  phone_masked: string | null;
  status: string | null;
  region_id: string | null;
  rating: string | null;
  total_rides: number | null;
  total_trips: number | null;
  created_at: string | null;
  updated_at: string | null;
}

/**
 * Calls core-api's internal/v1/customers/* directly and synchronously —
 * same pattern as every other query module (see
 * docs/admin-api/query-apis.md). Customers had no admin-facing read path
 * at all before this module existed — no controller, no route, nothing
 * beyond a customer_id embedded in a ride/trip/payment row.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly coreApi: CoreApiClientService) {}

  list(
    filters: ListCustomersDto,
    correlationId: string | undefined,
  ): Promise<PaginatedResponse<CustomerRow>> {
    return this.coreApi.get<PaginatedResponse<CustomerRow>>(
      '/api/internal/v1/customers',
      { ...filters },
      correlationId,
    );
  }

  findOne(
    customerId: string,
    correlationId: string | undefined,
  ): Promise<CustomerRow> {
    return this.coreApi.get<CustomerRow>(
      `/api/internal/v1/customers/${customerId}`,
      undefined,
      correlationId,
    );
  }
}
