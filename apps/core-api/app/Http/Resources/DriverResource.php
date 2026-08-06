<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\Driver
 */
class DriverResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->uuid,
            'status' => $this->status,
            'is_available' => $this->is_available,
            'rating' => $this->rating,
            'acceptance_rate' => $this->acceptance_rate,
            'region_id' => $this->region_id,
            'license_expires_at' => $this->license_expires_at?->toDateString(),
            'active_vehicle' => new VehicleResource($this->whenLoaded('activeVehicle')),
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}
