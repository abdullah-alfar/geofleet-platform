<?php

namespace App\Domain\Location;

use App\Domain\Outbox\Outbox;
use App\Models\Trip;
use App\Models\TripLocationSample;
use App\ValueObjects\GeoPoint;
use Illuminate\Support\Carbon;

/**
 * Decides whether a validated GPS update should be durably sampled into
 * trip route history, and if so, records it and enqueues a re-keyed
 * trip.location.updated.v1 outbox event ("realtime event preparation" —
 * driver_id-keyed events become trip_id-keyed ones, which is what
 * realtime-gateway will actually want to subscribe to per trip).
 *
 * Both writes happen inside the caller's transaction (see
 * App\Console\Commands\ConsumeLocationUpdates) alongside the inbox record,
 * so a redelivered Kafka message can never double-sample or double-publish.
 */
class LocationSampler
{
    public function __construct(
        private readonly int $minIntervalSeconds,
        private readonly float $minDistanceMeters,
    ) {}

    /**
     * @param  array{driver_id: string, device_id: string, trip_id: ?string, sequence: int, latitude: float, longitude: float, accuracy_meters: float, speed_mps: ?float, heading_degrees: ?float, recorded_at: string}  $data
     */
    public function handle(array $data, string $causationEventId): void
    {
        if (empty($data['trip_id'])) {
            return;
        }

        $trip = Trip::where('uuid', $data['trip_id'])
            ->where('status', 'in_progress')
            ->first();

        if (! $trip) {
            return;
        }

        // Don't trust the client-supplied trip_id blindly — cross-check it
        // actually belongs to the driver who sent this update (the same
        // "never trust mobile-provided identity" discipline location-service
        // applies to driver_id/device_id — see AGENTS.md).
        if ($trip->driver->uuid !== $data['driver_id']) {
            return;
        }

        $recordedAt = Carbon::parse($data['recorded_at']);

        if (! $this->shouldSample($trip, $recordedAt, $data['latitude'], $data['longitude'])) {
            return;
        }

        TripLocationSample::create([
            'trip_id' => $trip->id,
            'driver_id' => $trip->driver_id,
            'location' => new GeoPoint($data['latitude'], $data['longitude']),
            'speed_mps' => $data['speed_mps'] ?? null,
            'heading_degrees' => $data['heading_degrees'] ?? null,
            'accuracy_meters' => $data['accuracy_meters'],
            'recorded_at' => $recordedAt,
        ]);

        Outbox::record(
            aggregateType: 'trip',
            aggregateId: $trip->uuid,
            eventType: 'trip.location.updated',
            eventVersion: 1,
            data: [
                'trip_id' => $trip->uuid,
                'driver_id' => $data['driver_id'],
                'latitude' => $data['latitude'],
                'longitude' => $data['longitude'],
                'speed_mps' => $data['speed_mps'] ?? null,
                'heading_degrees' => $data['heading_degrees'] ?? null,
                'recorded_at' => $recordedAt->toISOString(),
            ],
            regionId: $trip->region_id,
            causationId: $causationEventId,
        );
    }

    /**
     * Throttles durable storage to roughly one sample per minIntervalSeconds
     * OR minDistanceMeters of movement, whichever comes first — raw GPS
     * ticks every few seconds would otherwise bloat trip_location_samples
     * for little benefit to route accuracy (brief: "Do not retain every GPS
     * point forever").
     */
    private function shouldSample(Trip $trip, Carbon $recordedAt, float $lat, float $lng): bool
    {
        $last = TripLocationSample::where('trip_id', $trip->id)
            ->orderByDesc('recorded_at')
            ->first();

        if (! $last) {
            return true;
        }

        if ($recordedAt->diffInSeconds($last->recorded_at, absolute: true) >= $this->minIntervalSeconds) {
            return true;
        }

        return $this->haversineMeters($last->location->lat, $last->location->lng, $lat, $lng) >= $this->minDistanceMeters;
    }

    private function haversineMeters(float $lat1, float $lng1, float $lat2, float $lng2): float
    {
        $earthRadius = 6371000.0;

        $dLat = deg2rad($lat2 - $lat1);
        $dLng = deg2rad($lng2 - $lng1);

        $a = sin($dLat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dLng / 2) ** 2;
        $c = 2 * atan2(sqrt($a), sqrt(1 - $a));

        return $earthRadius * $c;
    }
}
