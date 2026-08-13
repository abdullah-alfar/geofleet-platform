<?php

namespace App\Http\Controllers\Api\Internal\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Internal\AdminTripResource;
use App\Models\Trip;
use App\Support\CursorPagination;
use Illuminate\Http\Request;

class TripQueryController extends Controller
{
    public function index(Request $request): array
    {
        $filters = $request->validate([
            'status' => ['nullable', 'string'],
            'region_id' => ['nullable', 'string'],
            'driver_id' => ['nullable', 'uuid'],
            'customer_id' => ['nullable', 'uuid'],
            // Against started_at — trips have no requested_at of their own
            // (that belongs to the ride request that preceded the trip).
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date'],
            'minimum_price' => ['nullable', 'numeric'],
            'maximum_price' => ['nullable', 'numeric'],
            'cursor' => ['nullable', 'string'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
            // 'oldest' powers admin-api's incident feed (silent drivers on
            // an in-progress trip) — a one-shot capped fetch, no cursor.
            'order' => ['nullable', 'string', 'in:recent,oldest'],
        ]);

        $query = Trip::query()->with(['customer', 'driver']);

        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['region_id'])) {
            $query->where('region_id', $filters['region_id']);
        }
        if (isset($filters['driver_id'])) {
            $query->whereHas('driver', fn ($q) => $q->where('uuid', $filters['driver_id']));
        }
        if (isset($filters['customer_id'])) {
            $query->whereHas('customer', fn ($q) => $q->where('uuid', $filters['customer_id']));
        }
        if (isset($filters['date_from'])) {
            $query->where('started_at', '>=', $filters['date_from']);
        }
        if (isset($filters['date_to'])) {
            $query->where('started_at', '<=', $filters['date_to']);
        }
        if (isset($filters['minimum_price'])) {
            $query->where('fare_amount', '>=', $filters['minimum_price']);
        }
        if (isset($filters['maximum_price'])) {
            $query->where('fare_amount', '<=', $filters['maximum_price']);
        }

        $oldest = ($filters['order'] ?? 'recent') === 'oldest';

        $page = CursorPagination::paginate(
            $query,
            idColumn: 'uuid',
            orderColumn: $oldest ? 'started_at' : 'updated_at',
            cursor: $filters['cursor'] ?? null,
            limit: $filters['limit'] ?? 20,
            direction: $oldest ? 'asc' : 'desc',
        );

        return [
            'data' => AdminTripResource::collection($page['data']),
            'meta' => ['next_cursor' => $page['next_cursor']],
        ];
    }

    public function show(Trip $trip): array
    {
        $trip->load(['customer', 'driver']);

        return (new AdminTripResource($trip))->resolve() + [
            'timeline' => $this->buildTimeline($trip),
        ];
    }

    private function buildTimeline(Trip $trip): array
    {
        $milestones = [];
        $add = function (string $event, $at) use (&$milestones): void {
            if ($at !== null) {
                $milestones[] = ['event' => $event, 'at' => $at->toISOString()];
            }
        };
        $add('started', $trip->started_at);
        $add('completed', $trip->completed_at);
        $add('cancelled', $trip->cancelled_at);

        usort($milestones, fn ($a, $b) => $a['at'] <=> $b['at']);

        return $milestones;
    }
}
