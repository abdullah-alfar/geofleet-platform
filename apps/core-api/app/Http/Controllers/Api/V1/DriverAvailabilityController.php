<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Outbox\Outbox;
use App\Http\Controllers\Controller;
use App\Http\Requests\UpdateDriverAvailabilityRequest;
use App\Http\Resources\DriverResource;
use Illuminate\Support\Facades\DB;

class DriverAvailabilityController extends Controller
{
    public function update(UpdateDriverAvailabilityRequest $request): DriverResource
    {
        $driver = $request->user()->driver;
        $isAvailable = $request->boolean('is_available');

        // A suspended driver (admin-forced — see
        // App\Http\Controllers\Api\Internal\V1\DriverCommandController::suspend)
        // must not be able to immediately toggle themselves back available;
        // otherwise suspension has no actual effect on matchability.
        if ($isAvailable && $driver->status === 'suspended') {
            abort(403, 'This account is suspended and cannot go available.');
        }

        DB::transaction(function () use ($driver, $isAvailable) {
            $driver->forceFill([
                'is_available' => $isAvailable,
                'last_available_at' => $isAvailable ? now() : $driver->last_available_at,
            ])->save();

            // Consumed by location-service / dispatch-service in later
            // phases to know a driver has gone online/offline without
            // polling Postgres. driver_id (not device_id) is the partition
            // key — see docs/events/topic-catalog.md.
            Outbox::record(
                aggregateType: 'driver',
                aggregateId: $driver->uuid,
                eventType: 'driver.status.changed',
                eventVersion: 1,
                data: [
                    'driver_id' => $driver->uuid,
                    'is_available' => $isAvailable,
                ],
                regionId: $driver->region_id,
            );
        });

        return new DriverResource($driver->fresh());
    }
}
