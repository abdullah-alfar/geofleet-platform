<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->id();

            // Public identifier — never expose the sequential `id` in API
            // responses or URLs (IDOR risk / predictable enumeration).
            $table->uuid('uuid')->unique()->default(DB::raw('gen_random_uuid()'));

            $table->string('name');
            $table->string('email')->unique();
            $table->string('phone')->nullable()->unique();
            $table->timestamp('email_verified_at')->nullable();
            $table->string('password');

            // `role` decides which profile table (customers/drivers) a user
            // owns; `admin` has neither. Kept as a plain constrained column
            // rather than a full RBAC package — sufficient for MVP-scale
            // authorization (see docs/decisions and AGENTS.md).
            $table->string('role');
            $table->string('status')->default('active');

            // Carried on the user record (not just events) so region-scoped
            // queries (e.g. "active drivers in amman") don't need a join.
            $table->string('region_id')->default('amman');

            $table->rememberToken();
            $table->timestampsTz();
        });

        DB::statement("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('customer', 'driver', 'admin'))");
        DB::statement("ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'suspended', 'disabled'))");

        // Supports: "list active drivers/customers in region X" filters used
        // by admin tooling and future regional routing.
        Schema::table('users', function (Blueprint $table) {
            $table->index(['region_id', 'role']);
        });

        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestampTz('created_at')->nullable();
        });

        // No `sessions` table: SESSION_DRIVER is redis (see .env), so the
        // database-backed session table would be dead schema.
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('users');
        Schema::dropIfExists('password_reset_tokens');
    }
};
