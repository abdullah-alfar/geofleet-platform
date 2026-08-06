<?php

namespace App\Policies;

use App\Models\RideRequest;
use App\Models\User;

/**
 * Guards against IDOR: a customer must never read or cancel another
 * customer's ride request via a guessed/enumerated UUID (see AGENTS.md and
 * the brief's Security Requirements).
 */
class RideRequestPolicy
{
    public function view(User $user, RideRequest $rideRequest): bool
    {
        return $this->ownsAsCustomer($user, $rideRequest) || $this->ownsAsDriver($user, $rideRequest);
    }

    public function cancel(User $user, RideRequest $rideRequest): bool
    {
        return $this->ownsAsCustomer($user, $rideRequest);
    }

    private function ownsAsCustomer(User $user, RideRequest $rideRequest): bool
    {
        return $user->customer !== null && $user->customer->id === $rideRequest->customer_id;
    }

    private function ownsAsDriver(User $user, RideRequest $rideRequest): bool
    {
        return $user->driver !== null && $user->driver->id === $rideRequest->driver_id;
    }
}
