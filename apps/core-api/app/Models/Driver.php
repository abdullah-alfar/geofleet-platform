<?php

namespace App\Models;

use App\Models\Concerns\HasUuidRouteKey;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

#[Fillable(['user_id', 'license_number', 'license_expires_at', 'region_id'])]
class Driver extends Model
{
    use HasUuidRouteKey;

    protected function casts(): array
    {
        return [
            'license_expires_at' => 'date',
            'last_available_at' => 'datetime',
            'is_available' => 'boolean',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function vehicles(): HasMany
    {
        return $this->hasMany(Vehicle::class);
    }

    public function activeVehicle(): HasOne
    {
        return $this->hasOne(Vehicle::class)->where('is_active', true);
    }

    public function devices(): HasMany
    {
        return $this->hasMany(DriverDevice::class);
    }

    public function rideRequests(): HasMany
    {
        return $this->hasMany(RideRequest::class);
    }

    public function trips(): HasMany
    {
        return $this->hasMany(Trip::class);
    }

    /** Used by AdminDriverResource's `active_trip_id` — the only "current
     * state" a driver's own trips relation can answer live, no event log
     * needed. */
    public function activeTrip(): HasOne
    {
        return $this->hasOne(Trip::class)->where('status', 'in_progress');
    }
}
