<?php

namespace App\Policies;

use App\Models\Trip;
use App\Models\User;

class TripPolicy
{
    public function view(User $user, Trip $trip): bool
    {
        $ownsAsCustomer = $user->customer !== null && $user->customer->id === $trip->customer_id;
        $ownsAsDriver = $user->driver !== null && $user->driver->id === $trip->driver_id;

        return $ownsAsCustomer || $ownsAsDriver;
    }
}
