<?php

namespace App\Models;

use App\Casts\GeographyPoint;
use App\Models\Concerns\HasUuidRouteKey;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable([
    'customer_id', 'region_id', 'pickup_location', 'pickup_address',
    'dropoff_location', 'dropoff_address', 'requested_vehicle_type',
    'requested_at', 'idempotency_key',
])]
class RideRequest extends Model
{
    use HasUuidRouteKey;

    protected function casts(): array
    {
        return [
            'pickup_location' => GeographyPoint::class,
            'dropoff_location' => GeographyPoint::class,
            'requested_at' => 'datetime',
            'accepted_at' => 'datetime',
            'cancelled_at' => 'datetime',
        ];
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Customer::class);
    }

    public function driver(): BelongsTo
    {
        return $this->belongsTo(Driver::class);
    }

    public function offers(): HasMany
    {
        return $this->hasMany(RideOffer::class);
    }

    public function trip(): HasOne
    {
        return $this->hasOne(Trip::class);
    }
}
