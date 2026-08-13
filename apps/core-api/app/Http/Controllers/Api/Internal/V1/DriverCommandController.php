<?php

namespace App\Http\Controllers\Api\Internal\V1;

use App\Domain\Audit\AdminAudit;
use App\Domain\Outbox\Outbox;
use App\Http\Controllers\Controller;
use App\Http\Requests\Internal\AdminCommandRequest;
use App\Http\Requests\Internal\ApproveDriverRequest;
use App\Http\Requests\Internal\DisableDriverRequest;
use App\Http\Requests\Internal\SuspendDriverRequest;
use App\Http\Requests\Internal\UnsuspendDriverRequest;
use App\Http\Resources\DriverResource;
use App\Models\Driver;
use Illuminate\Support\Facades\DB;

class DriverCommandController extends Controller
{
    /**
     * Admin approval — the *only* code path in this entire platform that
     * ever moves a driver out of `pending_review` (the default status
     * every registration creates — see
     * database/migrations/2026_08_06_100020_create_drivers_table.php).
     * Without this, every driver who ever signs up stays pending forever;
     * confirmed by grepping the whole app for any other assignment to
     * `drivers.status` before this command existed.
     *
     * Strict, not idempotent like suspend()`: only succeeds from
     * `pending_review`. Re-approving an already-active driver isn't a
     * meaningful "ensure approved" no-op the way re-suspending is — it's
     * a caller/UI error (e.g. a double-click) that should surface as a
     * conflict, the same strictness `trips.cancel`/`payments.refund`
     * already apply to their own single-source-status transitions.
     *
     * No Kafka event: `driver.status.changed.v1`'s only real payload is
     * `{driver_id, is_available}` (see docs/admin-api/kafka-projections.md)
     * — approval doesn't change `is_available` (the driver still has to
     * explicitly go online themselves), so there's nothing this event
     * would honestly carry. No topic exists for a general status change
     * either. Same "don't force data into an event that doesn't fit"
     * reasoning as `payments.refund` publishing nothing.
     */
    public function approve(ApproveDriverRequest $request, Driver $driver): DriverResource
    {
        DB::transaction(function () use ($request, $driver): void {
            $affected = Driver::where('id', $driver->id)
                ->where('status', 'pending_review')
                ->update(['status' => 'active']);

            if ($affected === 0) {
                abort(409, "Driver cannot be approved from its current status ('{$driver->status}').");
            }

            AdminAudit::record(
                actor: $request->admin(),
                action: 'driver.approved',
                auditableType: 'driver',
                auditableId: $driver->id,
                changes: ['status' => ['from' => 'pending_review', 'to' => 'active'], 'reason' => $request->validated('reason')],
                regionId: $driver->region_id,
            );
        });

        return new DriverResource($driver->fresh());
    }

    /**
     * Admin-forced suspension. See setInactiveStatus() for the shared
     * mechanics — `disable()` below is the same shape for the harsher,
     * intended-as-more-permanent counterpart.
     */
    public function suspend(SuspendDriverRequest $request, Driver $driver): DriverResource
    {
        return $this->setInactiveStatus($request, $driver, 'suspended', 'driver.suspended');
    }

    /**
     * Admin-forced permanent removal — e.g. confirmed fraud, a driver who
     * should never be reinstated the way an unsuspend would allow. Same
     * mechanics as suspend() (see setInactiveStatus()): idempotent,
     * drops `is_available`, re-fires `driver.status.changed.v1` so
     * dispatch-service's Redis index drops the driver immediately.
     * Deliberately no reverse ("re-enable") command exists yet — not
     * asked for, and disabled is meant to read as a harder stop than
     * suspended, not just a synonym for it.
     */
    public function disable(DisableDriverRequest $request, Driver $driver): DriverResource
    {
        return $this->setInactiveStatus($request, $driver, 'disabled', 'driver.disabled');
    }

    /**
     * Shared by suspend() and disable(): both move a driver into a
     * standing where dispatch must stop offering them rides, regardless
     * of whatever status they were in before, and both should be safe to
     * call again on a driver already in the target state — "ensure this
     * driver is suspended/disabled" is the actual intent of either
     * command, not "transition from exactly one prior state" the way
     * approve()/unsuspend() are. Idempotent: a driver already in the
     * target status is a no-op, not an error, and doesn't write a
     * duplicate audit row or republish an unchanged event.
     */
    private function setInactiveStatus(
        AdminCommandRequest $request,
        Driver $driver,
        string $targetStatus,
        string $auditAction,
    ): DriverResource {
        $previousStatus = $driver->status;

        DB::transaction(function () use ($request, $driver, $previousStatus, $targetStatus, $auditAction): void {
            $affected = Driver::where('id', $driver->id)
                ->where('status', '!=', $targetStatus)
                ->update([
                    'status' => $targetStatus,
                    'is_available' => false,
                ]);

            if ($affected === 0) {
                return;
            }

            Outbox::record(
                aggregateType: 'driver',
                aggregateId: $driver->uuid,
                eventType: 'driver.status.changed',
                eventVersion: 1,
                data: [
                    'driver_id' => $driver->uuid,
                    'is_available' => false,
                ],
                regionId: $driver->region_id,
            );

            AdminAudit::record(
                actor: $request->admin(),
                action: $auditAction,
                auditableType: 'driver',
                auditableId: $driver->id,
                changes: ['status' => ['from' => $previousStatus, 'to' => $targetStatus], 'reason' => $request->validated('reason')],
                regionId: $driver->region_id,
            );
        });

        return new DriverResource($driver->fresh());
    }

    /**
     * The inverse of suspend() — restores a driver to `active` standing.
     * Strict, not idempotent, and deliberately narrower than approve():
     * only succeeds from `suspended`. A `disabled` driver does NOT become
     * active via this command — disable is meant to be a harder stop
     * than suspend, and silently letting "unsuspend" reverse it would
     * undermine that distinction. No Kafka event, same reasoning as
     * approve(): the driver still has to explicitly go online themselves
     * afterward, so `is_available` genuinely hasn't changed.
     */
    public function unsuspend(UnsuspendDriverRequest $request, Driver $driver): DriverResource
    {
        DB::transaction(function () use ($request, $driver): void {
            $affected = Driver::where('id', $driver->id)
                ->where('status', 'suspended')
                ->update(['status' => 'active']);

            if ($affected === 0) {
                abort(409, "Driver cannot be unsuspended from its current status ('{$driver->status}').");
            }

            AdminAudit::record(
                actor: $request->admin(),
                action: 'driver.unsuspended',
                auditableType: 'driver',
                auditableId: $driver->id,
                changes: ['status' => ['from' => 'suspended', 'to' => 'active'], 'reason' => $request->validated('reason')],
                regionId: $driver->region_id,
            );
        });

        return new DriverResource($driver->fresh());
    }
}
