<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Extends the `admin_api` role (2026_08_12_110000, auth-only until
     * now) with its own schema — `admin_read` — for the Kafka-projection
     * read models Phase 3+ of docs/admin-api/overview.md builds. One role
     * per service is the pattern every other Go service already follows
     * here (`dispatch_service` has both read and write grants under one
     * role, not two); admin-api's narrower Phase 2 grants weren't a
     * separate role for a separate purpose, just that purpose not
     * existing yet.
     *
     * `admin_api` becomes the schema's *owner* — full CREATE/ALTER/DROP
     * on tables within `admin_read`, and nothing outside it (no grant on
     * `public` beyond the three Phase 2 auth tables it can already
     * SELECT). admin-api's own Kysely migrations
     * (apps/admin-api/src/database/migrations/) create and evolve tables
     * inside this schema directly — core-api never defines admin-api's
     * read-model schema, only provisions the empty schema and hands over
     * ownership, the same "each service owns its own schema concerns"
     * boundary the outbox/inbox pattern already draws between core-api
     * and nothing (core-api owns `public` outright; no other service
     * gets a schema of its own to own until now).
     */
    public function up(): void
    {
        DB::statement('CREATE SCHEMA IF NOT EXISTS admin_read');
        DB::statement('ALTER SCHEMA admin_read OWNER TO admin_api');
    }

    public function down(): void
    {
        // CASCADE: admin-api's own tables inside this schema are dropped
        // with it — safe, since this schema has no source-of-truth data,
        // only rebuildable Kafka projections.
        DB::statement('DROP SCHEMA IF EXISTS admin_read CASCADE');
    }
};
