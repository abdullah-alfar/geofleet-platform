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
 * Audit *foundation* only: every admin command must be traceable, per the
 * original spec's Admin Audit section, but `admin_action_logs` doesn't
 * exist yet — that table needs the admin_read schema/migrations Phase 3
 * builds. Structured-logging the same shape now means Phase 6 (the first
 * phase with an actual command endpoint to audit) just calls `record()`
 * with no interface change, and Phase 3's persistence layer can replay
 * these from log storage if durable history is needed for anything issued
 * before it existed.
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
