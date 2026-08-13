<?php

namespace App\Http\Resources\Internal;

use App\Models\RideOffer;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * Field named `created_at` (not core-api's own `offered_at`) to match
 * admin-web's existing RideOffer type/template exactly — a deliberate
 * one-field alias rather than a frontend change for a rename that carries
 * no new information.
 *
 * @mixin RideOffer
 */
class AdminRideOfferResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'offer_id' => $this->uuid,
            'ride_request_id' => $this->whenLoaded('rideRequest', fn () => $this->rideRequest?->uuid),
            'driver_id' => $this->whenLoaded('driver', fn () => $this->driver?->uuid),
            'status' => $this->status,
            'created_at' => $this->offered_at?->toISOString(),
            'expires_at' => $this->expires_at?->toISOString(),
            'responded_at' => $this->responded_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
            'is_expired' => $this->status === 'pending' && $this->expires_at !== null && $this->expires_at->isPast(),
        ];
    }
}
