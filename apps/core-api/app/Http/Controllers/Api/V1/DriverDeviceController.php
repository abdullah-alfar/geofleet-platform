<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\StoreDriverDeviceRequest;
use App\Http\Resources\DriverDeviceResource;
use App\Models\DriverDevice;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class DriverDeviceController extends Controller
{
    public function index(Request $request): AnonymousResourceCollection
    {
        $devices = $request->user()->driver->devices()->latest()->get();

        return DriverDeviceResource::collection($devices);
    }

    public function store(StoreDriverDeviceRequest $request): JsonResponse
    {
        $driver = $request->user()->driver;
        $data = $request->validated();

        // This device credential (see AGENTS.md) is separate from the
        // driver's own Sanctum user token — location-service (Phase 3)
        // authenticates the device itself, not a logged-in user session.
        $token = DriverDevice::generateToken();

        // Postgres INSERT..RETURNING only returns `id`, so DB-generated
        // defaults (uuid, status) need an explicit refresh to appear on the
        // returned resource.
        $device = $driver->devices()->create([
            ...$data,
            'token_hash' => $token['hash'],
        ])->refresh();

        return (new DriverDeviceResource($device))
            ->additional(['meta' => [
                // Returned once; only the SHA-256 hash is ever persisted.
                'device_token' => $token['plainTextToken'],
            ]])
            ->response()
            ->setStatusCode(201);
    }
}
