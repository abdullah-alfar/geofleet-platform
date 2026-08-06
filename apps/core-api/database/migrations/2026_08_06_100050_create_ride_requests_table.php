<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ride_requests', function (Blueprint $table) {
            $table->id();

            // Also the Kafka partition key for ride.* lifecycle events (see
            // docs/events/topic-catalog.md) — all events for one ride land
            // on the same partition, giving per-ride ordering to consumers.
            $table->uuid('uuid')->unique()->default(DB::raw('gen_random_uuid()'));

            $table->foreignId('customer_id')->constrained('customers')->cascadeOnDelete();

            // Set only once the atomic acceptance UPDATE in dispatch-service
            // (Phase 5) succeeds. Nullable until then.
            $table->foreignId('driver_id')->nullable()->constrained('drivers')->nullOnDelete();

            $table->string('region_id')->default('amman');

            // searching: dispatch-service is looking for a driver.
            // offered: at least one offer is currently pending.
            // accepted: a driver accepted — this is the state the atomic
            //   `UPDATE ... WHERE status = 'searching'` transitions into.
            // cancelled: customer cancelled before/during matching.
            // expired: no driver accepted within the matching window.
            // unavailable: dispatch-service found no eligible candidates.
            $table->string('status')->default('searching');

            // longitude/latitude order — see docs/decisions/0002.
            $table->geography('pickup_location', 'point', 4326);
            $table->text('pickup_address')->nullable();
            $table->geography('dropoff_location', 'point', 4326);
            $table->text('dropoff_address')->nullable();

            $table->string('requested_vehicle_type');

            $table->timestampTz('requested_at');
            $table->timestampTz('accepted_at')->nullable();
            $table->timestampTz('cancelled_at')->nullable();
            $table->string('cancellation_reason')->nullable();

            // Client-supplied idempotency key (brief: "Idempotency keys for
            // sensitive create operations") — prevents duplicate ride
            // requests from a retried POST (e.g. flaky mobile network).
            $table->string('idempotency_key')->nullable();

            $table->timestampsTz();
        });

        DB::statement("ALTER TABLE ride_requests ADD CONSTRAINT ride_requests_status_check CHECK (status IN ('searching', 'offered', 'accepted', 'cancelled', 'expired', 'unavailable'))");
        DB::statement("ALTER TABLE ride_requests ADD CONSTRAINT ride_requests_vehicle_type_check CHECK (requested_vehicle_type IN ('sedan', 'suv', 'van', 'motorcycle'))");

        Schema::table('ride_requests', function (Blueprint $table) {
            // Supports: "does this customer already have a request in
            // flight with this idempotency key?" lookup on create, scoped
            // per customer since keys are client-generated and not globally
            // coordinated.
            $table->unique(['customer_id', 'idempotency_key']);

            // Supports: "a customer's ride request history" and the
            // ownership check on GET/cancel endpoints.
            $table->index(['customer_id', 'status']);

            // Supports: dispatch-service's future consumer picking up
            // 'searching' requests within a region.
            $table->index(['region_id', 'status']);

            // Supports: driver-side "my current/past ride requests".
            $table->index(['driver_id', 'status']);

            // Supports: PostGIS radius/nearest-driver-style queries against
            // pickup_location (used more directly once dispatch-service
            // exists, but the index is schema, not behavior, so it belongs
            // with the column from the start).
            $table->spatialIndex('pickup_location');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ride_requests');
    }
};
