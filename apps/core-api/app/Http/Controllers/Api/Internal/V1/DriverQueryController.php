<?php

namespace App\Http\Controllers\Api\Internal\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Internal\AdminDriverResource;
use App\Models\Driver;
use App\Support\CursorPagination;
use Illuminate\Http\Request;

/**
 * Read-side counterpart to DriverCommandController — admin-api's
 * DriversService calls these directly and synchronously instead of
 * querying its own Kafka-projected admin_read schema (removed; see
 * docs/admin-api/query-apis.md). Admin traffic is low-volume, so a plain
 * request/response round trip to core-api's own tables is simpler and
 * more honest than eventual consistency through a projection that only
 * ever served this one caller.
 */
class DriverQueryController extends Controller
{
    public function index(Request $request): array
    {
        $filters = $request->validate([
            'status' => ['nullable', 'string'],
            'availability_status' => ['nullable', 'string', 'in:available,unavailable'],
            'vehicle_type' => ['nullable', 'string'],
            'region_id' => ['nullable', 'string'],
            'last_seen_from' => ['nullable', 'date'],
            'last_seen_to' => ['nullable', 'date'],
            'rating_from' => ['nullable', 'numeric'],
            'rating_to' => ['nullable', 'numeric'],
            'search' => ['nullable', 'string'],
            'cursor' => ['nullable', 'string'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        $query = Driver::query()->with(['user', 'activeVehicle']);

        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['availability_status'])) {
            $query->where('is_available', $filters['availability_status'] === 'available');
        }
        if (isset($filters['vehicle_type'])) {
            $query->whereHas('activeVehicle', fn ($q) => $q->where('vehicle_type', $filters['vehicle_type']));
        }
        if (isset($filters['region_id'])) {
            $query->where('region_id', $filters['region_id']);
        }
        if (isset($filters['last_seen_from'])) {
            $query->where('last_available_at', '>=', $filters['last_seen_from']);
        }
        if (isset($filters['last_seen_to'])) {
            $query->where('last_available_at', '<=', $filters['last_seen_to']);
        }
        if (isset($filters['rating_from'])) {
            $query->where('rating', '>=', $filters['rating_from']);
        }
        if (isset($filters['rating_to'])) {
            $query->where('rating', '<=', $filters['rating_to']);
        }
        if (isset($filters['search'])) {
            $query->whereHas('user', fn ($q) => $q->where('name', 'ilike', $filters['search'].'%'));
        }

        $page = CursorPagination::paginate(
            $query,
            idColumn: 'uuid',
            orderColumn: 'updated_at',
            cursor: $filters['cursor'] ?? null,
            limit: $filters['limit'] ?? 20,
        );

        return [
            'data' => AdminDriverResource::collection($page['data']),
            'meta' => ['next_cursor' => $page['next_cursor']],
        ];
    }

    public function show(Driver $driver): AdminDriverResource
    {
        return new AdminDriverResource($driver->load(['user', 'activeVehicle', 'activeTrip']));
    }
}
