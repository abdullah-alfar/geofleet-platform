<?php

namespace App\Http\Controllers\Api\V1;

use App\Domain\Outbox\Outbox;
use App\Http\Controllers\Controller;
use App\Http\Requests\StoreRideRequestRequest;
use App\Http\Resources\RideRequestResource;
use App\Models\Customer;
use App\Models\RideRequest;
use App\ValueObjects\GeoPoint;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class RideRequestController extends Controller
{
    public function store(StoreRideRequestRequest $request): JsonResponse
    {
        $customer = $request->user()->customer;
        $data = $request->validated();
        $idempotencyKey = $request->header('Idempotency-Key');

        if ($idempotencyKey) {
            $existing = $customer->rideRequests()->where('idempotency_key', $idempotencyKey)->first();

            if ($existing) {
                return (new RideRequestResource($existing))->response()->setStatusCode(200);
            }
        }

        try {
            $rideRequest = $this->createRideRequest($customer, $data, $idempotencyKey);
        } catch (UniqueConstraintViolationException) {
            // Lost a race against a concurrent request carrying the same
            // idempotency key — the other request's row is now committed,
            // so return it rather than surfacing a 500.
            $rideRequest = $customer->rideRequests()->where('idempotency_key', $idempotencyKey)->firstOrFail();

            return (new RideRequestResource($rideRequest))->response()->setStatusCode(200);
        }

        return (new RideRequestResource($rideRequest))->response()->setStatusCode(201);
    }

    public function show(Request $request, RideRequest $rideRequest): RideRequestResource
    {
        $this->authorize('view', $rideRequest);

        return new RideRequestResource($rideRequest->load('driver'));
    }

    public function cancel(Request $request, RideRequest $rideRequest): RideRequestResource
    {
        $this->authorize('cancel', $rideRequest);

        if (! in_array($rideRequest->status, ['searching', 'offered'], true)) {
            abort(422, "Ride request cannot be cancelled from status '{$rideRequest->status}'.");
        }

        DB::transaction(function () use ($rideRequest) {
            // Atomic conditional update, same pattern as dispatch-service's
            // driver-acceptance transition (see AGENTS.md): only cancels if
            // the request is still in a cancellable state, closing the race
            // against a driver accepting it at the same moment.
            $affected = RideRequest::where('id', $rideRequest->id)
                ->whereIn('status', ['searching', 'offered'])
                ->update([
                    'status' => 'cancelled',
                    'cancelled_at' => now(),
                    'cancellation_reason' => 'cancelled_by_customer',
                ]);

            if ($affected === 0) {
                abort(409, 'Ride request was already assigned or resolved before cancellation.');
            }

            // No outbox event here deliberately: the Phase 1 topic catalog
            // (infrastructure/kafka/init-topics.sh) has no `ride.cancelled.*`
            // topic, and Kafka auto-create is disabled — publishing would
            // fail. This is also not required for correctness: dispatch-
            // service's atomic acceptance UPDATE (Phase 5) already guards on
            // `status = 'searching'`, so it will naturally fail to assign a
            // request that was cancelled out from under it. A dedicated
            // topic would only be needed later for *proactively* notifying
            // a driver mid-offer that the ride was cancelled (Phase 6
            // realtime-gateway) — flagged here rather than built ahead of
            // schedule.
        });

        return new RideRequestResource($rideRequest->fresh());
    }

    private function createRideRequest(Customer $customer, array $data, ?string $idempotencyKey): RideRequest
    {
        return DB::transaction(function () use ($customer, $data, $idempotencyKey) {
            $rideRequest = $customer->rideRequests()->create([
                'region_id' => $customer->user->region_id ?? config('events.default_region_id'),
                'pickup_location' => new GeoPoint($data['pickup_lat'], $data['pickup_lng']),
                'pickup_address' => $data['pickup_address'] ?? null,
                'dropoff_location' => new GeoPoint($data['dropoff_lat'], $data['dropoff_lng']),
                'dropoff_address' => $data['dropoff_address'] ?? null,
                'requested_vehicle_type' => $data['requested_vehicle_type'],
                'requested_at' => now(),
                'idempotency_key' => $idempotencyKey,
            ]);

            // Postgres INSERT..RETURNING only returns `id` (see
            // AuthController::register for the full explanation) — refresh
            // so `uuid` (used below as the outbox aggregate_id and Kafka
            // partition key) and `status` are actually populated rather
            // than null.
            $rideRequest->refresh();

            Outbox::record(
                aggregateType: 'ride_request',
                aggregateId: $rideRequest->uuid,
                eventType: 'ride.requested',
                eventVersion: 1,
                data: [
                    'ride_request_id' => $rideRequest->uuid,
                    'customer_id' => $customer->uuid,
                    'region_id' => $rideRequest->region_id,
                    'pickup' => ['lat' => $data['pickup_lat'], 'lng' => $data['pickup_lng']],
                    'dropoff' => ['lat' => $data['dropoff_lat'], 'lng' => $data['dropoff_lng']],
                    'requested_vehicle_type' => $data['requested_vehicle_type'],
                ],
                regionId: $rideRequest->region_id,
            );

            return $rideRequest;
        });
    }
}
