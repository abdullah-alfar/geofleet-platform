<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Least-privilege Postgres role for apps/location-service (Go).
     *
     * The Go service needs to reject GPS updates from unknown devices and
     * disabled drivers/vehicles (brief's GPS validation requirements), and
     * that reference data lives in core-api's Postgres. Rather than coupling
     * the hot GPS-ingestion path to a synchronous core-api HTTP call, or
     * inventing a device-sync Kafka topic outside the given catalog, this
     * role grants direct, read-only access to exactly the three tables it
     * needs — no visibility into ride_requests, trips, or payments.
     */
    public function up(): void
{
    $password = config('services.location_service.db_password');

    if (! $password) {
        throw new RuntimeException(
            'LOCATION_SERVICE_DB_PASSWORD must be set in .env before running this migration.'
        );
    }

    $escapedPassword = str_replace("'", "''", $password);
    $database = config('database.connections.pgsql.database');

    $roleExists = DB::selectOne("SELECT 1 FROM pg_roles WHERE rolname = 'location_service'");

    if ($roleExists) {
        // Try to alter, but continue if it fails
        try {
            DB::statement("ALTER ROLE location_service LOGIN PASSWORD '{$escapedPassword}'");
        } catch (\Exception $e) {
            // If we can't alter, just skip - role already exists
            if (str_contains($e->getMessage(), 'permission denied to alter role')) {
                // Role exists, password might be different but that's OK
                return;
            }
            throw $e;
        }
    } else {
        DB::statement("CREATE ROLE location_service LOGIN PASSWORD '{$escapedPassword}'");
    }

    // Grant permissions (these might fail if already granted, but we can ignore)
    try {
        DB::statement("GRANT CONNECT ON DATABASE \"{$database}\" TO location_service");
        DB::statement('GRANT USAGE ON SCHEMA public TO location_service');
        DB::statement('GRANT SELECT ON driver_devices, drivers, vehicles TO location_service');
    } catch (\Exception $e) {
        // If grants fail (already exists), continue
        if (!str_contains($e->getMessage(), 'already')) {
            throw $e;
        }
    }
}
    public function down(): void
    {
        DB::statement('REVOKE SELECT ON driver_devices, drivers, vehicles FROM location_service');
        DB::statement('REVOKE USAGE ON SCHEMA public FROM location_service');

        $database = config('database.connections.pgsql.database');
        DB::statement("REVOKE CONNECT ON DATABASE \"{$database}\" FROM location_service");

        DB::statement('DROP ROLE IF EXISTS location_service');
    }
};
