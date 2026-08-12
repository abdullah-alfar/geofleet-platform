<?php

namespace App\Console\Commands;

use App\Contracts\KafkaProducer;
use App\Models\DriverDevice;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;

/**
 * Provisions synthetic drivers/customers for scripts/loadtest, bypassing
 * the public HTTP registration endpoint on purpose — see
 * docs/decisions/0008-load-testing-approach.md. `POST /api/v1/auth/*` is
 * rate-limited to 10/minute per IP (`AppServiceProvider`'s `auth` limiter,
 * brute-force/enumeration protection per the brief's security
 * requirements), which is correct behavior for real traffic but makes it
 * the wrong path for bulk test-data provisioning from a single load-test
 * runner. This command is Eloquent-direct instead, and also skips the
 * (not-yet-built) admin driver-approval step by creating drivers already
 * `active` — the same workaround this repo's manual verification steps
 * already use via a direct SQL UPDATE.
 *
 * Outputs one JSON object to stdout — nothing else — so
 * scripts/loadtest can consume it directly:
 *
 *   {"drivers":[{"driver_uuid":"...","device_uuid":"...","device_token":"...","lat":0,"lng":0}],
 *    "customers":[{"customer_uuid":"...","token":"..."}]}
 *
 * The load tool still exercises every path this is meant to measure
 * (GPS ingestion, ride-request creation, matching) through the real HTTP
 * APIs, unmodified — only account provisioning is short-circuited.
 *
 * One more thing the real `PATCH /api/v1/driver/availability` endpoint
 * does that a direct `is_available` column write does NOT: publish
 * `driver.status.changed.v1`, which is how dispatch-service's Redis
 * geo-index (apps/dispatch-service/internal/driverindex) learns a driver
 * is available at all — without it, every seeded driver would be
 * permanently invisible to matching regardless of GPS updates. So this
 * command publishes that event directly via the same `KafkaProducer`
 * `PublishOutboxEvents` uses, rather than going through the outbox table:
 * there's no domain write here that needs to stay atomic with the
 * publish (this is synthetic test data, not a real business event), and
 * an immediate publish means the load tool doesn't need to wait out an
 * outbox-polling interval before its GPS phase starts.
 */
class LoadTestSeed extends Command
{
    protected $signature = 'loadtest:seed {--drivers=0} {--customers=0} {--base-lat=31.9539} {--base-lng=35.9106} {--run-id=}';

    protected $description = 'Provisions synthetic drivers/customers for scripts/loadtest and prints their credentials as JSON.';

    public function handle(KafkaProducer $producer): int
    {
        $driverCount = (int) $this->option('drivers');
        $customerCount = (int) $this->option('customers');
        $baseLat = (float) $this->option('base-lat');
        $baseLng = (float) $this->option('base-lng');
        $runID = $this->option('run-id') ?: (string) time();

        $passwordHash = Hash::make('loadtest-not-a-real-password');

        $drivers = [];
        DB::transaction(function () use ($driverCount, $runID, $passwordHash, $baseLat, $baseLng, &$drivers) {
            for ($i = 0; $i < $driverCount; $i++) {
                $user = User::create([
                    'name' => "Load Test Driver {$i}",
                    'email' => "loadtest-driver-{$runID}-{$i}@test.local",
                    'password' => $passwordHash,
                    'role' => 'driver',
                    'region_id' => config('events.default_region_id'),
                ]);

                $driver = $user->driver()->create([
                    'license_number' => "LOADTEST-{$runID}-{$i}",
                    'license_expires_at' => now()->addYears(5),
                    // Not $user->region_id: Postgres INSERT..RETURNING only
                    // returns `id` (see VehicleController's identical
                    // comment), so a DB-computed default on the just-created
                    // $user wouldn't be reflected on this in-memory instance
                    // without a refresh() — use the same source value
                    // directly instead.
                    'region_id' => config('events.default_region_id'),
                ])->refresh(); // same reason: pulls in the DB-generated uuid

                // status/is_available/last_available_at aren't mass-assignable
                // (see Driver's #[Fillable]) — forceFill to skip the
                // not-yet-built admin approval flow, same as this repo's
                // manual verification steps already do via a direct SQL
                // UPDATE (see this command's docblock).
                $driver->forceFill([
                    'status' => 'active',
                    'is_available' => true,
                    'last_available_at' => now(),
                ])->save();

                // New vehicles are active by default (see the vehicles
                // migration) — nothing else to set.
                $driver->vehicles()->create([
                    'make' => 'Toyota',
                    'model' => 'Camry',
                    'year' => 2022,
                    'color' => 'white',
                    'plate_number' => "LOAD-{$runID}-{$i}",
                    'vehicle_type' => 'sedan',
                ]);

                // New devices default to status='active' (see the
                // driver_devices migration) — nothing else to set.
                $token = DriverDevice::generateToken();
                $device = $driver->devices()->create([
                    'device_identifier' => "loadtest-device-{$runID}-{$i}",
                    'platform' => 'android',
                    'token_hash' => $token['hash'],
                ])->refresh(); // pulls in the DB-generated uuid, same reason as above

                [$lat, $lng] = $this->jitterPoint($baseLat, $baseLng);

                $drivers[] = [
                    'driver_uuid' => $driver->uuid,
                    'device_uuid' => $device->uuid,
                    'device_token' => $token['plainTextToken'],
                    'lat' => $lat,
                    'lng' => $lng,
                ];
            }
        });

        // Published after the transaction commits, not inside it — a
        // Kafka publish can't be rolled back, so this only happens once
        // the drivers it describes are durably persisted. See this
        // command's docblock for why this is a direct publish rather than
        // going through the outbox.
        foreach ($drivers as $seededDriver) {
            $producer->publish(
                topic: 'driver.status.changed.v1',
                key: $seededDriver['driver_uuid'],
                payload: json_encode([
                    'event_id' => (string) Str::uuid(),
                    'event_type' => 'driver.status.changed',
                    'event_version' => 1,
                    'occurred_at' => now()->toISOString(),
                    'producer' => config('events.producer'),
                    'correlation_id' => (string) Str::uuid(),
                    'causation_id' => null,
                    'aggregate_type' => 'driver',
                    'aggregate_id' => $seededDriver['driver_uuid'],
                    'region_id' => config('events.default_region_id'),
                    'data' => [
                        'driver_id' => $seededDriver['driver_uuid'],
                        'is_available' => true,
                    ],
                ], JSON_THROW_ON_ERROR),
            );
        }

        $customers = [];
        DB::transaction(function () use ($customerCount, $runID, $passwordHash, &$customers) {
            for ($i = 0; $i < $customerCount; $i++) {
                $user = User::create([
                    'name' => "Load Test Customer {$i}",
                    'email' => "loadtest-customer-{$runID}-{$i}@test.local",
                    'password' => $passwordHash,
                    'role' => 'customer',
                ]);

                // Postgres INSERT..RETURNING only returns `id` (see the
                // driver loop above) — refresh() to get the DB-generated
                // uuid onto this instance.
                $customer = $user->customer()->create([])->refresh();

                $token = $user->createToken('loadtest')->plainTextToken;

                $customers[] = [
                    'customer_uuid' => $customer->uuid,
                    'token' => $token,
                ];
            }
        });

        $this->line(json_encode(['drivers' => $drivers, 'customers' => $customers], JSON_THROW_ON_ERROR));

        return self::SUCCESS;
    }

    /**
     * Scatters a point within roughly +/-1km of the base — matches
     * scripts/loadtest's own jitter() so seeded drivers land within
     * geohash precision 6's 9-cell search radius (see docs/decisions/0005).
     */
    private function jitterPoint(float $baseLat, float $baseLng): array
    {
        $degreesPerKm = 0.009;
        $dLat = (mt_rand() / mt_getrandmax() * 2 - 1) * $degreesPerKm;
        $dLng = (mt_rand() / mt_getrandmax() * 2 - 1) * $degreesPerKm;

        return [$baseLat + $dLat, $baseLng + $dLng];
    }
}
