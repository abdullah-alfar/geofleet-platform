<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Widens the `admin_api` role from "auth-only, read personal_access_
     * tokens to verify a Sanctum token" (2026_08_12_110000) to "admin-api
     * is now an independent service with its own login/session store and
     * direct read/write access to every table its admin commands touch."
     * See docs/decisions/0011-admin-api-independent-service.md.
     *
     * Revokes what's now dead (admin-api no longer verifies Sanctum
     * tokens — it mints its own via admin_sessions, see
     * 2026_08_17_110000_create_admin_sessions_table.php) and grants what
     * the new direct-SQL modules need:
     *
     * - Full-table SELECT on drivers/vehicles/driver_devices/ride_requests/
     *   ride_offers/trips/payments/customers/admins — the same "broad read,
     *   narrow write" shape dispatch_service's own role already
     *   established (2026_08_09_100000) for the tables it's not the
     *   sole owner of.
     * - SELECT on users, widened past the old (id, uuid, status, role) to
     *   also include name/email/phone/password — password specifically
     *   because AdminAuthService now verifies it directly (bcrypt) at
     *   login instead of that check happening inside core-api's own
     *   AuthController. This is the one genuinely sensitive new grant
     *   here; scoped to exactly this column, nothing else on `users`.
     * - Column-scoped UPDATE, one column list per table, matching exactly
     *   what each ported admin command touches: drivers(status,
     *   is_available), trips(status, cancelled_at, cancellation_reason),
     *   payments(status), admins(admin_role), users(status).
     * - Full CRUD on admin_sessions — admin-api's own table, nothing else
     *   ever touches it.
     * - INSERT-only on outbox_events and audit_logs — admin-api writes
     *   rows into both (replicating what core-api's Outbox::record()/
     *   AdminAudit::record() used to do on its behalf), but never reads
     *   or updates them; core-api's existing `outbox:publish` loop is the
     *   only reader/updater of outbox_events, unchanged.
     */
    public function up(): void
    {
        DB::statement('REVOKE SELECT (id, tokenable_id, tokenable_type, token, abilities, expires_at) ON personal_access_tokens FROM admin_api');
        DB::statement('REVOKE SELECT (id, uuid, status, role) ON users FROM admin_api');
        DB::statement('REVOKE SELECT (user_id, admin_role) ON admins FROM admin_api');

        DB::statement('GRANT SELECT ON drivers, vehicles, driver_devices, ride_requests, ride_offers, trips, payments, customers, admins TO admin_api');
        DB::statement('GRANT SELECT (id, uuid, name, email, phone, password, status, role) ON users TO admin_api');

        DB::statement('GRANT UPDATE (status, is_available) ON drivers TO admin_api');
        DB::statement('GRANT UPDATE (status, cancelled_at, cancellation_reason) ON trips TO admin_api');
        DB::statement('GRANT UPDATE (status) ON payments TO admin_api');
        DB::statement('GRANT UPDATE (admin_role) ON admins TO admin_api');
        DB::statement('GRANT UPDATE (status) ON users TO admin_api');

        DB::statement('GRANT SELECT, INSERT, UPDATE, DELETE ON admin_sessions TO admin_api');
        DB::statement('GRANT USAGE, SELECT ON SEQUENCE admin_sessions_id_seq TO admin_api');

        DB::statement('GRANT INSERT ON outbox_events TO admin_api');
        DB::statement('GRANT USAGE, SELECT ON SEQUENCE outbox_events_id_seq TO admin_api');
        DB::statement('GRANT INSERT ON audit_logs TO admin_api');
        DB::statement('GRANT USAGE, SELECT ON SEQUENCE audit_logs_id_seq TO admin_api');
    }

    public function down(): void
    {
        DB::statement('REVOKE INSERT ON audit_logs FROM admin_api');
        DB::statement('REVOKE ALL ON SEQUENCE audit_logs_id_seq FROM admin_api');
        DB::statement('REVOKE INSERT ON outbox_events FROM admin_api');
        DB::statement('REVOKE ALL ON SEQUENCE outbox_events_id_seq FROM admin_api');

        DB::statement('REVOKE ALL ON admin_sessions FROM admin_api');
        DB::statement('REVOKE ALL ON SEQUENCE admin_sessions_id_seq FROM admin_api');

        DB::statement('REVOKE UPDATE (status) ON users FROM admin_api');
        DB::statement('REVOKE UPDATE (admin_role) ON admins FROM admin_api');
        DB::statement('REVOKE UPDATE (status) ON payments FROM admin_api');
        DB::statement('REVOKE UPDATE (status, cancelled_at, cancellation_reason) ON trips FROM admin_api');
        DB::statement('REVOKE UPDATE (status, is_available) ON drivers FROM admin_api');

        DB::statement('REVOKE SELECT (id, uuid, name, email, phone, password, status, role) ON users FROM admin_api');
        DB::statement('REVOKE SELECT ON drivers, vehicles, driver_devices, ride_requests, ride_offers, trips, payments, customers, admins FROM admin_api');

        DB::statement('GRANT SELECT (id, tokenable_id, tokenable_type, token, abilities, expires_at) ON personal_access_tokens TO admin_api');
        DB::statement('GRANT SELECT (id, uuid, status, role) ON users TO admin_api');
        DB::statement('GRANT SELECT (user_id, admin_role) ON admins TO admin_api');
    }
};
