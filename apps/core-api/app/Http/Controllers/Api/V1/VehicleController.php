<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreVehicleRequest;
use App\Http\Resources\VehicleResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

class VehicleController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $vehicles = $request->user()->driver->vehicles()
            ->latest()
            ->paginate(perPage: min((int) $request->integer('per_page', 15), 50));

        return VehicleResource::collection($vehicles);
    }

    public function store(StoreVehicleRequest $request): JsonResponse
    {
        $driver = $request->user()->driver;
        $data = $request->validated();

        $vehicle = DB::transaction(function () use ($driver, $data) {
            // Enforces "one active vehicle per driver" at the application
            // level, on top of the partial unique index that makes it
            // impossible to violate even under a race. New vehicles are
            // active by default (see migration), so nothing further is
            // needed after deactivating the rest.
            $driver->vehicles()->where('is_active', true)->update(['is_active' => false]);

            return $driver->vehicles()->create($data);
        });

        return (new VehicleResource($vehicle))->response()->setStatusCode(201);
    }
}
