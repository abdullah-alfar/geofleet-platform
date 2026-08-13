<?php

namespace App\Http\Resources\Internal;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The shape admin-api's DriversService reads directly (no Kafka
 * projection in between anymore — see docs/admin-api/query-apis.md).
 * Field names deliberately match the old admin_read.admin_driver_projection
 * columns admin-web's types/driver.ts already expects, except
 * `last_available_at` (replaces the old `last_seen_at`/`last_location_at`
 * pair — neither was ever derivable from core-api's own tables; this one
 * genuinely is, from `drivers.last_available_at`) and the addition of a
 * real `name`/`phone_masked`, which no Kafka event ever carried.
 *
 * @mixin \App\Models\Driver
 */
class AdminDriverResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'driver_id' => $this->uuid,
            'name' => $this->whenLoaded('user', fn () => $this->user->name),
            'phone_masked' => $this->whenLoaded('user', fn () => self::maskPhone($this->user->phone)),
            'status' => $this->status,
            'availability_status' => $this->is_available ? 'available' : 'unavailable',
            'vehicle_type' => $this->whenLoaded('activeVehicle', fn () => $this->activeVehicle?->vehicle_type),
            'rating' => $this->rating,
            'region_id' => $this->region_id,
            'active_trip_id' => $this->relationLoaded('activeTrip') ? $this->activeTrip?->uuid : null,
            'last_available_at' => $this->last_available_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }

    private static function maskPhone(?string $phone): ?string
    {
        if ($phone === null) {
            return null;
        }

        $visible = substr($phone, -4);

        return str_repeat('*', max(strlen($phone) - 4, 0)).$visible;
    }
}
