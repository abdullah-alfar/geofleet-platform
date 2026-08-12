<?php

namespace App\Http\Controllers\Api\Internal\V1;

use App\Domain\Audit\AdminAudit;
use App\Domain\Outbox\Outbox;
use App\Http\Controllers\Controller;
use App\Http\Requests\Internal\SuspendDriverRequest;
use App\Http\Resources\DriverResource;
use App\Models\Driver;
use Illuminate\Support\Facades\DB;

class DriverCommandController extends Controller
{
    /**
     * Admin-forced suspension. `drivers.status` (not `users.status`) is the
     * durable record of a driver's standing — see the drivers table
     * migration's own comment distinguishing it from `is_available` (the
     * driver's own live toggle). Also flips `is_available` false and
     * re-fires the existing `driver.status.changed.v1` event so dispatch-
     * service's Redis candidate index drops this driver immediately,
     * rather than waiting on nothing (dispatch never re-polls Postgres for
     * this). DriverAvailabilityController separately refuses to let a
     * suspended driver flip themselves back available.
     */
    public function suspend(SuspendDriverRequest $request, Driver $driver): DriverResource
    {
        $previousStatus = $driver->status;

        DB::transaction(function () use ($request, $driver, $previousStatus): void {
            $affected = Driver::where('id', $driver->id)
                ->where('status', '!=', 'suspended')
                ->update([
                    'status' => 'suspended',
                    'is_available' => false,
                ]);

            if ($affected === 0) {
                // Already suspended — idempotent no-op, not an error, but
                // no reason to write a second audit row or re-publish an
                // event nothing changed.
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
                action: 'driver.suspended',
                auditableType: 'driver',
                auditableId: $driver->id,
                changes: ['status' => ['from' => $previousStatus, 'to' => 'suspended'], 'reason' => $request->validated('reason')],
                regionId: $driver->region_id,
            );
        });

        return new DriverResource($driver->fresh());
    }
}
