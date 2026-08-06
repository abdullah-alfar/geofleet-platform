<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ride_offers', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique()->default(DB::raw('gen_random_uuid()'));

            $table->foreignId('ride_request_id')->constrained('ride_requests')->cascadeOnDelete();
            $table->foreignId('driver_id')->constrained('drivers')->cascadeOnDelete();

            $table->string('status')->default('pending');

            $table->timestampTz('offered_at');
            $table->timestampTz('expires_at');
            $table->timestampTz('responded_at')->nullable();

            // Populated by dispatch-service's ranking strategy (Phase 5) for
            // debugging/observability into why a driver was offered a ride.
            $table->decimal('rank_score', 8, 4)->nullable();

            $table->timestampsTz();
        });

        DB::statement("ALTER TABLE ride_offers ADD CONSTRAINT ride_offers_status_check CHECK (status IN ('pending', 'accepted', 'rejected', 'expired'))");

        Schema::table('ride_offers', function (Blueprint $table) {
            // Supports: preventing dispatch-service from offering the same
            // ride to the same driver twice concurrently.
            $table->unique(['ride_request_id', 'driver_id']);

            // Supports: "does this driver have a pending offer right now?"
            // check before creating a new one.
            $table->index(['driver_id', 'status']);

            // Supports: the offer-expiration sweep (Phase 5/7) selecting
            // pending offers whose expires_at has passed.
            $table->index(['status', 'expires_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ride_offers');
    }
};
