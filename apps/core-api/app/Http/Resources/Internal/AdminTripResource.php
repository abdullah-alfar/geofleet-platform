<?php

namespace App\Http\Resources\Internal;

use App\Models\Trip;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * `fare_amount` replaces the old projection's `estimated_price`/
 * `final_price` split — core-api's own `trips` table only ever had one
 * price column (set once, at completion; null until then). That split
 * was invented for the Kafka event schema and never actually populated
 * (trip.* events have no producer — see the platform-wide gap this
 * resource makes moot by reading `trips` directly instead of waiting on
 * an event that was never going to fire).
 *
 * @mixin Trip
 */
class AdminTripResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'trip_id' => $this->uuid,
            'customer_id' => $this->whenLoaded('customer', fn () => $this->customer?->uuid),
            'driver_id' => $this->whenLoaded('driver', fn () => $this->driver?->uuid),
            'region_id' => $this->region_id,
            'status' => $this->status,
            'pickup_latitude' => $this->pickup_location?->lat,
            'pickup_longitude' => $this->pickup_location?->lng,
            'dropoff_latitude' => $this->dropoff_location?->lat,
            'dropoff_longitude' => $this->dropoff_location?->lng,
            'distance_meters' => $this->distance_meters,
            'duration_seconds' => $this->duration_seconds,
            'fare_amount' => $this->fare_amount,
            'currency' => $this->currency,
            'started_at' => $this->started_at?->toISOString(),
            'completed_at' => $this->completed_at?->toISOString(),
            'cancelled_at' => $this->cancelled_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
