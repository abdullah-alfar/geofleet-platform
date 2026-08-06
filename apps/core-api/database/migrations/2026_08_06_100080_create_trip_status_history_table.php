<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trip_status_history', function (Blueprint $table) {
            $table->id();
            $table->foreignId('trip_id')->constrained('trips')->cascadeOnDelete();

            $table->string('status');
            $table->timestampTz('occurred_at');

            // Free-form context for the transition (e.g. cancellation
            // reason, the actor who triggered it). Kept as jsonb rather than
            // fixed columns since what's worth recording differs per
            // transition.
            $table->jsonb('metadata')->nullable();

            $table->timestampTz('created_at')->useCurrent();
        });

        DB::statement("ALTER TABLE trip_status_history ADD CONSTRAINT trip_status_history_status_check CHECK (status IN ('in_progress', 'completed', 'cancelled'))");

        // Supports: rendering a trip's full timeline in chronological order
        // (customer support / audit use cases).
        Schema::table('trip_status_history', function (Blueprint $table) {
            $table->index(['trip_id', 'occurred_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trip_status_history');
    }
};
