<?php

namespace App\Http\Controllers\Api\Internal\V1;

use App\Http\Controllers\Controller;
use App\Http\Resources\Internal\AdminRideOfferResource;
use App\Http\Resources\Internal\AdminRideResource;
use App\Models\RideRequest;
use App\Support\CursorPagination;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

class RideQueryController extends Controller
{
    public function index(Request $request): array
    {
        $filters = $request->validate([
            'status' => ['nullable', 'string'],
            'region_id' => ['nullable', 'string'],
            'customer_id' => ['nullable', 'uuid'],
            'driver_id' => ['nullable', 'uuid'],
            'date_from' => ['nullable', 'date'],
            'date_to' => ['nullable', 'date'],
            'cursor' => ['nullable', 'string'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:500'],
            // 'oldest' powers admin-api's incident feed (stuck-searching
            // rides) — a one-shot capped fetch, not real pagination, so it
            // never sends a cursor alongside it.
            'order' => ['nullable', 'string', 'in:recent,oldest'],
        ]);

        $query = RideRequest::query()->with(['customer', 'driver']);

        if (isset($filters['status'])) {
            $query->where('status', $filters['status']);
        }
        if (isset($filters['region_id'])) {
            $query->where('region_id', $filters['region_id']);
        }
        if (isset($filters['customer_id'])) {
            $query->whereHas('customer', fn ($q) => $q->where('uuid', $filters['customer_id']));
        }
        if (isset($filters['driver_id'])) {
            $query->whereHas('driver', fn ($q) => $q->where('uuid', $filters['driver_id']));
        }
        if (isset($filters['date_from'])) {
            $query->where('requested_at', '>=', $filters['date_from']);
        }
        if (isset($filters['date_to'])) {
            $query->where('requested_at', '<=', $filters['date_to']);
        }

        $oldest = ($filters['order'] ?? 'recent') === 'oldest';

        $page = CursorPagination::paginate(
            $query,
            idColumn: 'uuid',
            orderColumn: $oldest ? 'requested_at' : 'updated_at',
            cursor: $filters['cursor'] ?? null,
            limit: $filters['limit'] ?? 20,
            direction: $oldest ? 'asc' : 'desc',
        );

        return [
            'data' => AdminRideResource::collection($page['data']),
            'meta' => ['next_cursor' => $page['next_cursor']],
        ];
    }

    public function show(RideRequest $rideRequest): array
    {
        $rideRequest->load(['customer', 'driver']);

        return (new AdminRideResource($rideRequest))->resolve() + [
            'timeline' => $this->buildTimeline($rideRequest),
        ];
    }

    public function offers(RideRequest $rideRequest): AnonymousResourceCollection
    {
        $offers = $rideRequest->offers()
            ->with('driver')
            ->orderBy('offered_at', 'asc')
            ->limit(100)
            ->get();

        return AdminRideOfferResource::collection($offers);
    }

    /**
     * Only real ride_requests columns — see AdminRideResource's own note
     * on why search_started_at/assigned_at/unavailable_at aren't here.
     */
    private function buildTimeline(RideRequest $rideRequest): array
    {
        $milestones = [];
        $add = function (string $event, $at) use (&$milestones): void {
            if ($at !== null) {
                $milestones[] = ['event' => $event, 'at' => $at->toISOString()];
            }
        };
        $add('requested', $rideRequest->requested_at);
        $add('accepted', $rideRequest->accepted_at);
        $add('cancelled', $rideRequest->cancelled_at);

        usort($milestones, fn ($a, $b) => $a['at'] <=> $b['at']);

        return $milestones;
    }
}
