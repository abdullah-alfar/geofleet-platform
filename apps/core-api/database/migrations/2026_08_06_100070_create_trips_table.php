<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('trips', function (Blueprint $table) {
            $table->id();

            // Kafka partition key for trip.* events — per-trip ordering.
            $table->uuid('uuid')->unique()->default(DB::raw('gen_random_uuid()'));

            // One trip per ride request: a trip only exists once matching
            // succeeded and the driver actually starts the ride (the
            // "assigned but en route to pickup" phase lives on the ride
            // request itself, not here — see ride_requests.status).
            $table->foreignId('ride_request_id')->unique()->constrained('ride_requests')->restrictOnDelete();

            $table->foreignId('customer_id')->constrained('customers')->restrictOnDelete();
            $table->foreignId('driver_id')->constrained('drivers')->restrictOnDelete();
            $table->foreignId('vehicle_id')->constrained('vehicles')->restrictOnDelete();

            $table->string('status')->default('in_progress');

            $table->geography('pickup_location', 'point', 4326);
            // Actual drop-off may differ from the ride request's requested
            // drop-off (route changes mid-trip); nullable until completion.
            $table->geography('dropoff_location', 'point', 4326)->nullable();

            $table->decimal('distance_meters', 10, 2)->nullable();
            $table->integer('duration_seconds')->nullable();
            $table->decimal('fare_amount', 10, 2)->nullable();
            $table->char('currency', 3)->default('JOD');

            $table->string('region_id')->default('amman');

            $table->timestampTz('started_at');
            $table->timestampTz('completed_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->string('cancellation_reason')->nullable();

            $table->timestampsTz();
        });

        DB::statement("ALTER TABLE trips ADD CONSTRAINT trips_status_check CHECK (status IN ('in_progress', 'completed', 'cancelled'))");

        Schema::table('trips', function (Blueprint $table) {
            // Supports: "a customer's trip history" and ownership checks.
            $table->index(['customer_id', 'status']);

            // Supports: "a driver's trip history / current trip".
            $table->index(['driver_id', 'status']);

            // Supports: PostGIS queries over completed trip pickup/drop-off
            // points (e.g. demand heatmaps) mentioned in the brief's spatial
            // design section.
            $table->spatialIndex('pickup_location');
            $table->spatialIndex('dropoff_location');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('trips');
    }
};
