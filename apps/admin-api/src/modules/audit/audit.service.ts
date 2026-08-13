import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { AdminPrincipal } from '../auth/admin-principal.interface';

export interface AuditEntry {
  admin: AdminPrincipal;
  action: string;
  resourceType?: string;
  resourceId?: string;
  reason?: string;
  correlationId: string | null;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

/**
 * A structured-log mirror of every admin command, for local observability
 * only — the durable, queryable record lives in core-api's own
 * `audit_logs` table (`AdminAudit::record`, written by the command
 * itself once it lands there), not here. admin-api never had its own
 * audit table; the admin_read schema this comment used to point at for
 * one is gone now regardless (see docs/admin-api/query-apis.md).
 *
 * Never pass secrets in `metadata` — this is logged, and logs are not a
 * secrets store (see AppModule's pino redact config for what's already
 * scrubbed from request/response objects; that redaction does not apply
 * to arbitrary fields passed here).
 */
@Injectable()
export class AuditService {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AuditService.name);
  }

  record(entry: AuditEntry): void {
    this.logger.info(
      {
        admin_id: entry.admin.userId,
        admin_role: entry.admin.adminRole,
        action: entry.action,
        resource_type: entry.resourceType,
        resource_id: entry.resourceId,
        reason: entry.reason,
        correlation_id: entry.correlationId,
        ip_address: entry.ipAddress,
        user_agent: entry.userAgent,
        metadata: entry.metadata,
      },
      'admin.audit',
    );
  }
}
