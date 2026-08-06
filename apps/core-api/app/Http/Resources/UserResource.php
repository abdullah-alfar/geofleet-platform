<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * @mixin \App\Models\User
 */
class UserResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->uuid,
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $this->phone,
            'role' => $this->role,
            'status' => $this->status,
            'region_id' => $this->region_id,
            'customer' => new CustomerResource($this->whenLoaded('customer')),
            'driver' => new DriverResource($this->whenLoaded('driver')),
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}
