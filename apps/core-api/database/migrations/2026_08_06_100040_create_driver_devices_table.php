<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('driver_devices', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique()->default(DB::raw('gen_random_uuid()'));

            $table->foreignId('driver_id')->constrained('drivers')->cascadeOnDelete();

            // Client-generated device identifier (e.g. app install ID).
            // Globally unique: one device belongs to exactly one driver.
            $table->string('device_identifier')->unique();

            // Device credentials are a separate credential from the driver's
            // own Sanctum user token (see AGENTS.md) — location-service
            // (Phase 3) authenticates the *device*, not a logged-in user
            // session. Only the SHA-256 hash is stored; the raw token is
            // returned once at registration and never persisted.
            $table->string('token_hash')->unique();

            $table->string('platform');
            $table->string('app_version')->nullable();
            $table->string('status')->default('active');
            $table->timestampTz('last_seen_at')->nullable();

            $table->timestampsTz();
        });

        DB::statement("ALTER TABLE driver_devices ADD CONSTRAINT driver_devices_platform_check CHECK (platform IN ('ios', 'android'))");
        DB::statement("ALTER TABLE driver_devices ADD CONSTRAINT driver_devices_status_check CHECK (status IN ('active', 'revoked'))");

        // Supports: "does this driver have any active devices?" and device
        // listing on the driver's account page.
        Schema::table('driver_devices', function (Blueprint $table) {
            $table->index(['driver_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('driver_devices');
    }
};
