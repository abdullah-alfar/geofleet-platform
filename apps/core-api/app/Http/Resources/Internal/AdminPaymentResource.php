<?php

namespace App\Http\Resources\Internal;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * `region_id` isn't a `payments` column — derived from the related trip's
 * region, the same denormalization the old Kafka projection did at
 * write-time. Here it's just a join, evaluated live.
 *
 * @mixin \App\Models\Payment
 */
class AdminPaymentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'payment_id' => $this->uuid,
            'trip_id' => $this->whenLoaded('trip', fn () => $this->trip?->uuid),
            'customer_id' => $this->whenLoaded('customer', fn () => $this->customer?->uuid),
            'status' => $this->status,
            'provider' => $this->provider,
            'amount' => $this->amount,
            'currency' => $this->currency,
            'region_id' => $this->whenLoaded('trip', fn () => $this->trip?->region_id),
            'created_at' => $this->created_at?->toISOString(),
            'paid_at' => $this->paid_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
