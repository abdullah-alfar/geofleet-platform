<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\TripResource;
use App\Models\Trip;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Request;

class TripController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $user = $request->user();

        $query = match (true) {
            $user->isCustomer() => Trip::where('customer_id', $user->customer->id),
            $user->isDriver() => Trip::where('driver_id', $user->driver->id),
            default => Trip::whereRaw('1 = 0'),
        };

        $trips = $query->with(['driver', 'vehicle'])
            ->latest('started_at')
            ->paginate(perPage: min((int) $request->integer('per_page', 15), 50));

        return TripResource::collection($trips);
    }

    public function show(Request $request, Trip $trip): TripResource
    {
        $this->authorize('view', $trip);

        return new TripResource($trip->load(['driver', 'vehicle']));
    }
}
