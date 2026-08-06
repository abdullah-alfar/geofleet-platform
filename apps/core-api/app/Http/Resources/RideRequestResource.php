<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\RideRequest
 */
class RideRequestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->uuid,
            'status' => $this->status,
            'region_id' => $this->region_id,
            'pickup' => $this->pickup_location,
            'pickup_address' => $this->pickup_address,
            'dropoff' => $this->dropoff_location,
            'dropoff_address' => $this->dropoff_address,
            'requested_vehicle_type' => $this->requested_vehicle_type,
            'requested_at' => $this->requested_at?->toISOString(),
            'accepted_at' => $this->accepted_at?->toISOString(),
            'cancelled_at' => $this->cancelled_at?->toISOString(),
            'driver' => new DriverResource($this->whenLoaded('driver')),
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}
