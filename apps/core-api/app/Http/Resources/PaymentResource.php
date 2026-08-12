<?php

namespace App\Http\Resources;

use App\Models\Payment;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin Payment
 */
class PaymentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->uuid,
            'trip_id' => $this->whenLoaded('trip', fn () => $this->trip->uuid),
            'amount' => $this->amount,
            'currency' => $this->currency,
            'status' => $this->status,
            'provider' => $this->provider,
            'provider_reference' => $this->provider_reference,
            'failure_reason' => $this->failure_reason,
            'paid_at' => $this->paid_at?->toISOString(),
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}
