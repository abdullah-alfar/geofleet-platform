<?php

namespace App\Http\Controllers\Api\Internal\V1;

use App\Domain\Audit\AdminAudit;
use App\Http\Controllers\Controller;
use App\Http\Requests\Internal\RefundPaymentRequest;
use App\Http\Resources\PaymentResource;
use App\Models\Payment;
use Illuminate\Support\Facades\DB;

class PaymentCommandController extends Controller
{
    /**
     * Admin-forced refund. Deliberately does not publish a Kafka event:
     * the topic catalog (docs/events/topic-catalog.md) has no
     * `payment.refunded.v1` — only `payment.requested/completed/failed`
     * exist, and Kafka auto-topic-creation is disabled cluster-wide, so
     * publishing would fail outright. Same reasoning
     * RideRequestController::cancel already documents for its own
     * missing-topic case: adding a new topic is a platform-infrastructure
     * change (infrastructure/kafka/init-topics.sh, Phase 1 scope), not
     * something to introduce as a side effect of one admin command. The
     * audit trail (`audit_logs`, Postgres-only) still captures the refund
     * regardless of Kafka.
     */
    /** ->resolve(), not a bare Resource return — a bare Resource gets
     * auto-wrapped in `{"data": {...}}` by Laravel's JsonResource default;
     * admin-api forwards this response flat to admin-web. */
    public function refund(RefundPaymentRequest $request, Payment $payment): array
    {
        $payment->loadMissing('trip');

        DB::transaction(function () use ($request, $payment): void {
            $affected = Payment::where('id', $payment->id)
                ->where('status', 'completed')
                ->update(['status' => 'refunded']);

            if ($affected === 0) {
                abort(409, "Payment cannot be refunded from its current status ('{$payment->status}').");
            }

            AdminAudit::record(
                actor: $request->admin(),
                action: 'payment.refunded',
                auditableType: 'payment',
                auditableId: $payment->id,
                changes: ['status' => ['from' => 'completed', 'to' => 'refunded'], 'reason' => $request->validated('reason')],
                regionId: $payment->trip?->region_id,
            );
        });

        return (new PaymentResource($payment->fresh()))->resolve();
    }
}
