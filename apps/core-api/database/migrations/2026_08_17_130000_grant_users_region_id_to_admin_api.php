<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Gap found live: the customers module needs users.region_id
     * (AdminCustomerResource's `region_id` field, and the customers
     * list's own region_id filter) — missed from
     * 2026_08_17_120000_broaden_admin_api_role's column list, which only
     * anticipated auth + basic-profile columns. Same pattern as that
     * migration, just one more column.
     */
    public function up(): void
    {
        DB::statement('GRANT SELECT (region_id) ON users TO admin_api');
    }

    public function down(): void
    {
        DB::statement('REVOKE SELECT (region_id) ON users FROM admin_api');
    }
};
