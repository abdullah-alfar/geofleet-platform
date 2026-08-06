<?php

namespace App\Models;

use App\Models\Concerns\HasUuidRouteKey;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

#[Fillable(['user_id', 'rating'])]
class Customer extends Model
{
    use HasUuidRouteKey;

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function rideRequests(): HasMany
    {
        return $this->hasMany(RideRequest::class);
    }

    public function trips(): HasMany
    {
        return $this->hasMany(Trip::class);
    }
}
