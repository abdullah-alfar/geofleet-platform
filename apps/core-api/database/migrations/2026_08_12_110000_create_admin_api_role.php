<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Read-only, authentication-only Postgres role for apps/admin-api
     * (NestJS). See docs/decisions/0009-admin-identity.md.
     *
     * Grants, precisely:
     * - Column-scoped SELECT on personal_access_tokens
     *   (id, tokenable_id, tokenable_type, token, abilities, expires_at) —
     *   the same Sanctum-token-verification query
     *   apps/realtime-gateway's role already runs (split
     *   "{id}|{plaintext}", hash the plaintext, match by id), plus
     *   `abilities` — realtime-gateway never needed it (no permission
     *   model for customers/drivers), admin-api does (see
     *   App\Support\AdminPermissions).
     * - Column-scoped SELECT on users (id, uuid, status, role) — realtime-
     *   gateway's grant is (id, status) only; admin-api additionally needs
     *   `role` (confirm the token belongs to an admin, not a customer/
     *   driver token that happens to be well-formed) and `uuid` (the
     *   public identifier surfaced to admin-web / recorded on audit
     *   entries — AGENTS.md: never expose the sequential `id`).
     * - Column-scoped SELECT on admins (user_id, admin_role) — resolves
     *   which permission set the token's abilities were issued for. No
     *   `admins.uuid` grant: `users.uuid` already serves as this admin's
     *   public identifier, same as every other role in this schema.
     *
     * No access to any core-api domain table (ride_requests, trips,
     * payments, drivers, ...) — this role exists to answer exactly one
     * question, "is this bearer token a live admin session and what can
     * it do," never to read or write business data. admin-api's actual
     * read models come from Kafka projections into its own schema
     * (Phase 3), never from querying core-api's tables directly.
     */
    public function up(): void
    {
        $password = config('services.admin_api.db_password');

        if (! $password) {
            throw new RuntimeException(
                'ADMIN_API_DB_PASSWORD must be set in .env before running this migration.'
            );
        }

        $escapedPassword = str_replace("'", "''", $password);
        $database = config('database.connections.pgsql.database');

        $roleExists = DB::selectOne("SELECT 1 FROM pg_roles WHERE rolname = 'admin_api'");

        DB::statement($roleExists
            ? "ALTER ROLE admin_api LOGIN PASSWORD '{$escapedPassword}'"
            : "CREATE ROLE admin_api LOGIN PASSWORD '{$escapedPassword}'"
        );

        DB::statement("GRANT CONNECT ON DATABASE \"{$database}\" TO admin_api");
        DB::statement('GRANT USAGE ON SCHEMA public TO admin_api');

        DB::statement('GRANT SELECT (id, tokenable_id, tokenable_type, token, abilities, expires_at) ON personal_access_tokens TO admin_api');
        DB::statement('GRANT SELECT (id, uuid, status, role) ON users TO admin_api');
        DB::statement('GRANT SELECT (user_id, admin_role) ON admins TO admin_api');
    }

    public function down(): void
    {
        DB::statement('REVOKE SELECT (user_id, admin_role) ON admins FROM admin_api');
        DB::statement('REVOKE SELECT (id, uuid, status, role) ON users FROM admin_api');
        DB::statement('REVOKE SELECT (id, tokenable_id, tokenable_type, token, abilities, expires_at) ON personal_access_tokens FROM admin_api');

        DB::statement('REVOKE USAGE ON SCHEMA public FROM admin_api');

        $database = config('database.connections.pgsql.database');
        DB::statement("REVOKE CONNECT ON DATABASE \"{$database}\" FROM admin_api");

        DB::statement('DROP ROLE IF EXISTS admin_api');
    }
};
