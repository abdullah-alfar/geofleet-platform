<?php

namespace App\Http\Resources\Internal;

use App\Models\Customer;
use App\Support\PhoneMask;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The shape admin-api's CustomersService reads directly — no Kafka
 * projection, no read model of any kind, same as every other internal/v1
 * query resource (see docs/admin-api/query-apis.md). `total_rides`/
 * `total_trips` are only present on the detail response
 * (CustomerQueryController::show() eager-loads the counts;
 * index() deliberately doesn't, to avoid an aggregate on every row of a
 * paginated list).
 *
 * @mixin Customer
 */
class AdminCustomerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'customer_id' => $this->uuid,
            'name' => $this->whenLoaded('user', fn () => $this->user->name),
            'email' => $this->whenLoaded('user', fn () => $this->user->email),
            'phone_masked' => $this->whenLoaded('user', fn () => PhoneMask::apply($this->user->phone)),
            'status' => $this->whenLoaded('user', fn () => $this->user->status),
            'region_id' => $this->whenLoaded('user', fn () => $this->user->region_id),
            'rating' => $this->rating,
            'total_rides' => isset($this->ride_requests_count) ? (int) $this->ride_requests_count : null,
            'total_trips' => isset($this->trips_count) ? (int) $this->trips_count : null,
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
        ];
    }
}
