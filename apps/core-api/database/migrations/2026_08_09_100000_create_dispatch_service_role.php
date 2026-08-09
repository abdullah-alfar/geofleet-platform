<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Postgres role for apps/dispatch-service (Go). Unlike location_service
     * (read-only — see 2026_08_06_150000_create_location_service_role.php),
     * this role needs narrow write access: it performs the atomic
     * ride-acceptance transition directly against Postgres (the brief's
     * required concurrency mechanism — a conditional UPDATE is the only way
     * to get exactly-one-winner semantics without a distributed lock), and
     * it fully owns ride_offers. See
     * docs/decisions/0005-geohash-and-dispatch-db-access.md.
     *
     * Grants, precisely:
     * - SELECT on ride_requests, drivers, vehicles, driver_devices
     *   (candidate lookup, vehicle-type filtering, ranking inputs, and
     *   device-token auth for the accept/reject HTTP endpoints — reusing
     *   location-service's exact device-auth pattern).
     * - UPDATE on ride_requests, but ONLY the columns the atomic-acceptance
     *   transition touches (status, driver_id, accepted_at) — column-level
     *   GRANT, not table-wide. Cannot touch pickup/dropoff, payment-adjacent
     *   fields, or anything else on that row.
     * - SELECT, INSERT, UPDATE on ride_offers — the one table this service
     *   owns outright.
     *
     * No access to customers, payments, trips, audit_logs, or anything
     * else.
     */
    public function up(): void
    {
        $password = config('services.dispatch_service.db_password');

        if (! $password) {
            throw new RuntimeException(
                'DISPATCH_SERVICE_DB_PASSWORD must be set in .env before running this migration.'
            );
        }

        $escapedPassword = str_replace("'", "''", $password);
        $database = config('database.connections.pgsql.database');

        $roleExists = DB::selectOne("SELECT 1 FROM pg_roles WHERE rolname = 'dispatch_service'");

        DB::statement($roleExists
            ? "ALTER ROLE dispatch_service LOGIN PASSWORD '{$escapedPassword}'"
            : "CREATE ROLE dispatch_service LOGIN PASSWORD '{$escapedPassword}'"
        );

        DB::statement("GRANT CONNECT ON DATABASE \"{$database}\" TO dispatch_service");
        DB::statement('GRANT USAGE ON SCHEMA public TO dispatch_service');

        DB::statement('GRANT SELECT ON ride_requests, drivers, vehicles, driver_devices TO dispatch_service');
        DB::statement('GRANT UPDATE (status, driver_id, accepted_at) ON ride_requests TO dispatch_service');

        DB::statement('GRANT SELECT, INSERT, UPDATE ON ride_offers TO dispatch_service');
        DB::statement('GRANT USAGE, SELECT ON SEQUENCE ride_offers_id_seq TO dispatch_service');
    }

    public function down(): void
    {
        DB::statement('REVOKE ALL ON ride_offers FROM dispatch_service');
        DB::statement('REVOKE ALL ON SEQUENCE ride_offers_id_seq FROM dispatch_service');
        DB::statement('REVOKE UPDATE (status, driver_id, accepted_at) ON ride_requests FROM dispatch_service');
        DB::statement('REVOKE SELECT ON ride_requests, drivers, vehicles, driver_devices FROM dispatch_service');
        DB::statement('REVOKE USAGE ON SCHEMA public FROM dispatch_service');

        $database = config('database.connections.pgsql.database');
        DB::statement("REVOKE CONNECT ON DATABASE \"{$database}\" FROM dispatch_service");

        DB::statement('DROP ROLE IF EXISTS dispatch_service');
    }
};
