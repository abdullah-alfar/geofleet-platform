<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Read-only Postgres role for apps/realtime-gateway (Go). See
     * docs/decisions/0006-realtime-gateway-fanout.md.
     *
     * Grants, precisely:
     * - SELECT on driver_devices, drivers — identical device-token
     *   authentication query location-service and dispatch-service already
     *   run (hash the bearer token, look up driver_devices, join drivers
     *   for status). Same tables, same table-wide grant, no new pattern.
     * - Column-scoped SELECT on personal_access_tokens
     *   (id, tokenable_id, tokenable_type, token, expires_at), users
     *   (id, status), and customers (uuid, user_id) — enough to
     *   authenticate a customer's Sanctum bearer token the same way
     *   Sanctum's own PersonalAccessToken::findToken() does (split
     *   "{id}|{plaintext}", hash the plaintext, match by id), then resolve
     *   which customer it belongs to. Deliberately narrower than
     *   dispatch_service's customers grant: no `id` needed here (joins via
     *   user_id), and users is scoped to (id, status) only — this role
     *   never sees a password hash, email, phone, or name.
     *
     * No access to ride_requests, ride_offers, trips, payments, or
     * anything else — realtime-gateway never queries Postgres for domain
     * state, only for authenticating a WebSocket upgrade. See the ADR for
     * why everything else it needs (ride/customer/driver-assignment
     * correlation) comes from Kafka event payloads and its own Redis state
     * instead of a database join.
     */
    public function up(): void
    {
        $password = config('services.realtime_gateway.db_password');

        if (! $password) {
            throw new RuntimeException(
                'REALTIME_GATEWAY_DB_PASSWORD must be set in .env before running this migration.'
            );
        }

        $escapedPassword = str_replace("'", "''", $password);
        $database = config('database.connections.pgsql.database');

        $roleExists = DB::selectOne("SELECT 1 FROM pg_roles WHERE rolname = 'realtime_gateway'");

        DB::statement($roleExists
            ? "ALTER ROLE realtime_gateway LOGIN PASSWORD '{$escapedPassword}'"
            : "CREATE ROLE realtime_gateway LOGIN PASSWORD '{$escapedPassword}'"
        );

        DB::statement("GRANT CONNECT ON DATABASE \"{$database}\" TO realtime_gateway");
        DB::statement('GRANT USAGE ON SCHEMA public TO realtime_gateway');

        DB::statement('GRANT SELECT ON driver_devices, drivers TO realtime_gateway');

        DB::statement('GRANT SELECT (id, tokenable_id, tokenable_type, token, expires_at) ON personal_access_tokens TO realtime_gateway');
        DB::statement('GRANT SELECT (id, status) ON users TO realtime_gateway');
        DB::statement('GRANT SELECT (uuid, user_id) ON customers TO realtime_gateway');
    }

    public function down(): void
    {
        DB::statement('REVOKE SELECT (uuid, user_id) ON customers FROM realtime_gateway');
        DB::statement('REVOKE SELECT (id, status) ON users FROM realtime_gateway');
        DB::statement('REVOKE SELECT (id, tokenable_id, tokenable_type, token, expires_at) ON personal_access_tokens FROM realtime_gateway');
        DB::statement('REVOKE SELECT ON driver_devices, drivers FROM realtime_gateway');
        DB::statement('REVOKE USAGE ON SCHEMA public FROM realtime_gateway');

        $database = config('database.connections.pgsql.database');
        DB::statement("REVOKE CONNECT ON DATABASE \"{$database}\" FROM realtime_gateway");

        DB::statement('DROP ROLE IF EXISTS realtime_gateway');
    }
};
