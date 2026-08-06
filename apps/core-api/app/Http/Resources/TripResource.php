<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Trip
 */
class TripResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->uuid,
            'status' => $this->status,
            'region_id' => $this->region_id,
            'pickup' => $this->pickup_location,
            'dropoff' => $this->dropoff_location,
            'distance_meters' => $this->distance_meters,
            'duration_seconds' => $this->duration_seconds,
            'fare_amount' => $this->fare_amount,
            'currency' => $this->currency,
            'started_at' => $this->started_at?->toISOString(),
            'completed_at' => $this->completed_at?->toISOString(),
            'cancelled_at' => $this->cancelled_at?->toISOString(),
            'driver' => new DriverResource($this->whenLoaded('driver')),
            'vehicle' => new VehicleResource($this->whenLoaded('vehicle')),
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}
