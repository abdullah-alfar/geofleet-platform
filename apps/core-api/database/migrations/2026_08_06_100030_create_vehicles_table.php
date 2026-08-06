<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('vehicles', function (Blueprint $table) {
            $table->id();
            $table->uuid('uuid')->unique()->default(DB::raw('gen_random_uuid()'));

            // A driver may register several vehicles over time (history), but
            // only one is active at once — enforced by the partial unique
            // index below rather than application-only logic.
            $table->foreignId('driver_id')->constrained('drivers')->cascadeOnDelete();

            $table->string('make');
            $table->string('model');
            $table->smallInteger('year');
            $table->string('color');
            $table->string('plate_number')->unique();

            // Drives ride-request/vehicle-type matching in dispatch-service
            // (Phase 5): a customer requesting "sedan" should not be matched
            // to a motorcycle.
            $table->string('vehicle_type');
            $table->string('status')->default('active');
            $table->boolean('is_active')->default(true);

            $table->timestampsTz();
        });

        DB::statement("ALTER TABLE vehicles ADD CONSTRAINT vehicles_type_check CHECK (vehicle_type IN ('sedan', 'suv', 'van', 'motorcycle'))");
        DB::statement("ALTER TABLE vehicles ADD CONSTRAINT vehicles_status_check CHECK (status IN ('active', 'inactive', 'maintenance'))");

        // Supports: "does this driver already have an active vehicle?" check
        // performed when activating a new one — one row per driver where
        // is_active is true, enforced by Postgres rather than a race-prone
        // read-then-write in application code.
        DB::statement('CREATE UNIQUE INDEX vehicles_one_active_per_driver ON vehicles (driver_id) WHERE is_active = true');

        // Supports: "list vehicles for driver X" (profile/admin views).
        Schema::table('vehicles', function (Blueprint $table) {
            $table->index('driver_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('vehicles');
    }
};
