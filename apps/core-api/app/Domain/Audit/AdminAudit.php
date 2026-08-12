<?php

namespace App\Domain\Audit;

use App\Models\AuditLog;
use App\Models\User;

/**
 * Writes an `audit_logs` row for an admin-initiated command (suspend a
 * driver, cancel a trip, refund a payment — internal/v1/* controllers).
 * `audit_logs` has existed since the original 8-phase plan
 * (2026_08_06_100120_create_audit_logs_table) but nothing wrote to it
 * until admin-api's Phase 6 gave this platform its first actions worth
 * auditing (an admin's own `dashboard.view`/`*.view` reads are not —
 * only state-changing commands are).
 *
 * Callers MUST invoke this inside the same DB::transaction() as the
 * domain write it accompanies, same rule as App\Domain\Outbox\Outbox —
 * an audit row for a mutation that then rolls back would be a lie.
 */
class AdminAudit
{
    public static function record(
        User $actor,
        string $action,
        string $auditableType,
        int $auditableId,
        array $changes = [],
        ?string $regionId = null,
    ): AuditLog {
        return AuditLog::create([
            'actor_type' => 'admin',
            'actor_id' => $actor->id,
            'action' => $action,
            'auditable_type' => $auditableType,
            'auditable_id' => $auditableId,
            'changes' => $changes,
            'region_id' => $regionId,
            'occurred_at' => now(),
        ]);
    }
}
