<?php

namespace App\Http\Controllers\Api\Internal\V1;

use App\Domain\Audit\AdminAudit;
use App\Domain\Outbox\Outbox;
use App\Http\Controllers\Controller;
use App\Http\Requests\Internal\CancelTripRequest;
use App\Http\Resources\TripResource;
use App\Models\Trip;
use Illuminate\Support\Facades\DB;

class TripCommandController extends Controller
{
    /**
     * Admin-forced cancellation. Unlike the customer-initiated
     * RideRequestController::cancel (a pre-trip, `ride_requests`
     * concern), this operates on an in-progress `trips` row and is the
     * first live producer for `trip.cancelled.v1` — a topic the Phase 1
     * catalog reserved but never had a producer for (see
     * docs/events/topic-catalog.md). No other service consumes it yet
     * (realtime-gateway's consumer is still "planned"), but publishing
     * now is correct and costs nothing: the topic already exists, and a
     * future consumer can rely on this event existing retroactively for
     * every admin cancellation from this point on.
     */
    /** ->resolve(), not a bare Resource return — a bare Resource gets
     * auto-wrapped in `{"data": {...}}` by Laravel's JsonResource default;
     * admin-api forwards this response flat to admin-web. */
    public function cancel(CancelTripRequest $request, Trip $trip): array
    {
        DB::transaction(function () use ($request, $trip): void {
            $reason = $request->validated('reason') ?? 'cancelled_by_admin';

            $affected = Trip::where('id', $trip->id)
                ->where('status', 'in_progress')
                ->update([
                    'status' => 'cancelled',
                    'cancelled_at' => now(),
                    'cancellation_reason' => $reason,
                ]);

            if ($affected === 0) {
                abort(409, "Trip cannot be cancelled from its current status ('{$trip->status}').");
            }

            Outbox::record(
                aggregateType: 'trip',
                aggregateId: $trip->uuid,
                eventType: 'trip.cancelled',
                eventVersion: 1,
                data: [
                    'trip_id' => $trip->uuid,
                    'reason' => $reason,
                ],
                regionId: $trip->region_id,
            );

            AdminAudit::record(
                actor: $request->admin(),
                action: 'trip.cancelled',
                auditableType: 'trip',
                auditableId: $trip->id,
                changes: ['status' => ['from' => 'in_progress', 'to' => 'cancelled'], 'reason' => $reason],
                regionId: $trip->region_id,
            );
        });

        return (new TripResource($trip->fresh()))->resolve();
    }
}
