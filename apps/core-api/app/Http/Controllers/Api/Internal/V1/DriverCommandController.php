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
     */
    /** ->resolve(), not a bare Resource return — a bare Resource gets
     * auto-wrapped in `{"data": {...}}` by Laravel's JsonResource default;
     * admin-api's DriversService forwards this response flat to
     * admin-web, which reads `result.status` directly. */
    public function approve(ApproveDriverRequest $request, Driver $driver): array
    {
        DB::transaction(function () use ($request, $driver): void {
            $affected = Driver::where('id', $driver->id)
                ->where('status', 'pending_review')
                ->update(['status' => 'active']);

            if ($affected === 0) {
                abort(409, "Driver cannot be approved from its current status ('{$driver->status}').");
            }

            $this->publishStatusChanged($driver, 'active');

            AdminAudit::record(
                actor: $request->admin(),
                action: 'driver.approved',
                auditableType: 'driver',
                auditableId: $driver->id,
                changes: ['status' => ['from' => 'pending_review', 'to' => 'active'], 'reason' => $request->validated('reason')],
                regionId: $driver->region_id,
            );
        });

        return (new DriverResource($driver->fresh()))->resolve();
    }

    /**
     * Admin-forced suspension. See setInactiveStatus() for the shared
     * mechanics — `disable()` below is the same shape for the harsher,
     * intended-as-more-permanent counterpart.
     */
    public function suspend(SuspendDriverRequest $request, Driver $driver): array
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
    public function disable(DisableDriverRequest $request, Driver $driver): array
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
    ): array {
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

            $this->publishStatusChanged($driver, $targetStatus, isAvailable: false);

            AdminAudit::record(
                actor: $request->admin(),
                action: $auditAction,
                auditableType: 'driver',
                auditableId: $driver->id,
                changes: ['status' => ['from' => $previousStatus, 'to' => $targetStatus], 'reason' => $request->validated('reason')],
                regionId: $driver->region_id,
            );
        });

        return (new DriverResource($driver->fresh()))->resolve();
    }

    /**
     * The inverse of suspend() — restores a driver to `active` standing.
     * Strict, not idempotent, and deliberately narrower than approve():
     * only succeeds from `suspended`. A `disabled` driver does NOT become
     * active via this command — disable is meant to be a harder stop
     * than suspend, and silently letting "unsuspend" reverse it would
     * undermine that distinction.
     */
    public function unsuspend(UnsuspendDriverRequest $request, Driver $driver): array
    {
        DB::transaction(function () use ($request, $driver): void {
            $affected = Driver::where('id', $driver->id)
                ->where('status', 'suspended')
                ->update(['status' => 'active']);

            if ($affected === 0) {
                abort(409, "Driver cannot be unsuspended from its current status ('{$driver->status}').");
            }

            $this->publishStatusChanged($driver, 'active');

            AdminAudit::record(
                actor: $request->admin(),
                action: 'driver.unsuspended',
                auditableType: 'driver',
                auditableId: $driver->id,
                changes: ['status' => ['from' => 'suspended', 'to' => 'active'], 'reason' => $request->validated('reason')],
                regionId: $driver->region_id,
            );
        });

        return (new DriverResource($driver->fresh()))->resolve();
    }

    /**
     * All four commands publish through here now — a real gap caught
     * live (not in review): `driver.status.changed.v1`'s payload used to
     * carry only `is_available`, and approve()/unsuspend() published
     * nothing at all, on the reasoning that neither actually changes
     * `is_available`. That reasoning was correct as far as it went, but
     * missed the actual point of the event from admin-api's side —
     * admin_driver_projection.status has no *other* source, so a driver
     * approved/suspended/unsuspended/disabled through the admin panel
     * would update core-api's real `drivers.status` while the admin
     * panel's own list view showed it, permanently, exactly as it had
     * before the command ran. Now every driver-status command publishes
     * `status` alongside `is_available` — the topic is literally named
     * "driver status changed," so this is a more complete event, not a
     * new one. Backward compatible: dispatch-service's own consumer
     * (encoding/json, unknown-field-tolerant) already ignores fields it
     * doesn't declare in its struct.
     *
     * `$isAvailable` defaults to the driver's own current value — approve
     * and unsuspend never touch `is_available` themselves (a driver still
     * has to explicitly go online via PATCH /driver/availability), so the
     * event should report whatever that value already, genuinely is, not
     * force it to a fixed one the way suspend/disable's own transition
     * actually does.
     */
    private function publishStatusChanged(Driver $driver, string $status, ?bool $isAvailable = null): void
    {
        Outbox::record(
            aggregateType: 'driver',
            aggregateId: $driver->uuid,
            eventType: 'driver.status.changed',
            eventVersion: 1,
            data: [
                'driver_id' => $driver->uuid,
                'is_available' => $isAvailable ?? $driver->is_available,
                'status' => $status,
            ],
            regionId: $driver->region_id,
        );
    }
}
