<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Reverses 2026_08_13_100000_grant_admin_read_schema_to_admin_api.php.
 * admin-api no longer runs a Kafka consumer or maintains a projected read
 * model — its query modules call core-api's own internal/v1/* read
 * endpoints directly and synchronously instead (see
 * docs/admin-api/query-apis.md). `admin_read` had no source-of-truth
 * data, only rebuildable projections, so dropping it loses nothing.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement('DROP SCHEMA IF EXISTS admin_read CASCADE');
    }

    public function down(): void
    {
        DB::statement('CREATE SCHEMA IF NOT EXISTS admin_read');
        DB::statement('ALTER SCHEMA admin_read OWNER TO admin_api');
    }
};
