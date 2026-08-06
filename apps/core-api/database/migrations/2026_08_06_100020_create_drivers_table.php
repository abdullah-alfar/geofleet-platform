<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('drivers', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique()->default(DB::raw('gen_random_uuid()'));

            $table->foreignId('user_id')->unique()->constrained('users')->cascadeOnDelete();

            $table->string('license_number')->unique();
            $table->date('license_expires_at');

            // pending_review: submitted, awaiting admin approval before going live.
            $table->string('status')->default('pending_review');

            // Live toggle a driver flips via PATCH /api/v1/driver/availability.
            // This is the durable record of intent; location-service (Phase 3)
            // and dispatch-service (Phase 5) read the fast-changing "is this
            // driver actually reachable right now" state from Redis, not here.
            $table->boolean('is_available')->default(false);
            $table->timestampTz('last_available_at')->nullable();

            $table->decimal('rating', 3, 2)->nullable();

            // Used by the dispatch-service ranking strategy (Phase 5) —
            // fraction of offers accepted out of offers received. Nullable
            // until a driver has received at least one offer.
            $table->decimal('acceptance_rate', 5, 4)->nullable();

            $table->string('region_id')->default('amman');

            $table->timestampsTz();
        });

        DB::statement("ALTER TABLE drivers ADD CONSTRAINT drivers_status_check CHECK (status IN ('pending_review', 'active', 'suspended', 'disabled'))");
        DB::statement('ALTER TABLE drivers ADD CONSTRAINT drivers_rating_range_check CHECK (rating IS NULL OR (rating >= 1.00 AND rating <= 5.00))');
        DB::statement('ALTER TABLE drivers ADD CONSTRAINT drivers_acceptance_rate_range_check CHECK (acceptance_rate IS NULL OR (acceptance_rate >= 0 AND acceptance_rate <= 1))');

        // Supports admin/reporting queries like "active, available drivers in
        // region X" without touching Redis (the hot path for actual dispatch
        // candidate search stays in Redis/H3 — see Phase 5).
        Schema::table('drivers', function (Blueprint $table) {
            $table->index(['region_id', 'status', 'is_available']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('drivers');
    }
};
