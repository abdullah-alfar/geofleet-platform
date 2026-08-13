import { Injectable } from '@nestjs/common';
import { CoreApiClientService } from '../../integrations/core-api/core-api-client.service';
import { AdminPrincipal } from '../auth/admin-principal.interface';

/** core-api's own AdminAccountResource shape — an admin account as a
 * manageable resource, not the `{userId, adminRole, abilities}`
 * AdminPrincipal shape /session returns for the caller's own identity. */
export interface AdminAccountRow {
  id: string;
  /** users.uuid — distinct from `id` above (this Admin row's own uuid).
   * Matches AdminPrincipal.userId (/session), so admin-web can tell
   * which row is the caller's own account. */
  user_id: string;
  name: string;
  email: string;
  admin_role: string;
  status: string;
  created_at: string | null;
}

/**
 * Forwards every call to core-api's internal/v1/admins/* — admin
 * accounts live in core-api's `public` schema (`users`/`admins`), which
 * admin-api never reads or writes directly beyond its own narrow
 * auth-verification grant (see docs/decisions/0009-admin-identity.md).
 * There's no Kafka projection for "who are the admins" — unlike
 * drivers/rides/trips/payments, this isn't event-sourced domain data,
 * it's a handful of platform-security-config rows with no need for
 * eventual consistency or historical replay. See
 * docs/admin-api/laravel-integration.md.
 */
@Injectable()
export class AdminsService {
  constructor(private readonly coreApi: CoreApiClientService) {}

  async list(correlationId: string | undefined): Promise<AdminAccountRow[]> {
    const response = await this.coreApi.get<{ data: AdminAccountRow[] }>(
      '/api/internal/v1/admins',
      correlationId,
    );
    return response.data;
  }

  updateRole(
    adminId: string,
    admin: AdminPrincipal,
    newRole: string,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.coreApi.patch(
      `/api/internal/v1/admins/${adminId}/role`,
      { admin_user_id: admin.userId, admin_role: newRole, reason },
      correlationId,
    );
  }

  deactivate(
    adminId: string,
    admin: AdminPrincipal,
    reason: string | undefined,
    correlationId: string | undefined,
  ): Promise<Record<string, unknown>> {
    return this.coreApi.patch(
      `/api/internal/v1/admins/${adminId}/deactivate`,
      { admin_user_id: admin.userId, reason },
      correlationId,
    );
  }
}
