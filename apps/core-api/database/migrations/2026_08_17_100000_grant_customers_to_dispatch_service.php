<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Fixes a real gap: 2026_08_09_100000_create_dispatch_service_role's
     * own docblock says the role gets `SELECT (id, uuid) ON customers`
     * (needed by the atomic-acceptance transaction — see
     * internal/offerstore/store.go's `AcceptOffer`, which resolves the
     * ride's customer_id to a public uuid for the ride.assigned.v1
     * payload), and the `GRANT` statement is right there in that
     * migration's `up()`. But it was added to that file *after* the
     * migration had already run in this environment — Laravel only runs
     * a migration once, ever, so editing an already-applied file has no
     * effect on a database that already migrated. The live grant never
     * existed here: `\dp customers` showed no `dispatch_service` entry at
     * all, and every ride-offer acceptance failed with
     * `permission denied for table customers (SQLSTATE 42501)`,
     * surfaced as a 500 from `POST /v1/ride-offers/{id}/accept`.
     *
     * The fix is a new migration, not an edit to the old one — the
     * project's own established pattern for exactly this situation (see
     * 2026_08_13_100000_grant_admin_read_schema_to_admin_api, added
     * alongside the already-applied admin_api role migration rather than
     * editing it).
     */
    public function up(): void
    {
        DB::statement('GRANT SELECT (id, uuid) ON customers TO dispatch_service');
    }

    public function down(): void
    {
        DB::statement('REVOKE SELECT (id, uuid) ON customers FROM dispatch_service');
    }
};
