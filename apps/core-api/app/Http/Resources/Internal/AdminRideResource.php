<?php

namespace App\Http\Resources\Internal;

use App\Models\RideRequest;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Only real `ride_requests` columns — no `search_started_at`/`assigned_at`/
 * `unavailable_at`, which only ever existed as separate Kafka event
 * timestamps (ride.search.started/assigned/unavailable.v1). `status`
 * already carries that information now ('searching', 'offered',
 * 'accepted', 'unavailable', ...); `accepted_at` is core-api's own real
 * column for the "a driver accepted" milestone. See
 * RideQueryController::buildTimeline().
 *
 * @mixin RideRequest
 */
class AdminRideResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'ride_request_id' => $this->uuid,
            'customer_id' => $this->whenLoaded('customer', fn () => $this->customer?->uuid),
            'driver_id' => $this->whenLoaded('driver', fn () => $this->driver?->uuid),
            'region_id' => $this->region_id,
            'status' => $this->status,
            'pickup_latitude' => $this->pickup_location?->lat,
            'pickup_longitude' => $this->pickup_location?->lng,
            'dropoff_latitude' => $this->dropoff_location?->lat,
            'dropoff_longitude' => $this->dropoff_location?->lng,
            'requested_at' => $this->requested_at?->toISOString(),
            'accepted_at' => $this->accepted_at?->toISOString(),
            'cancelled_at' => $this->cancelled_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
