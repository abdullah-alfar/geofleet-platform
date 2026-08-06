<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * trip_location_samples is a declaratively partitioned table
     * (PARTITION BY RANGE on recorded_at) — see
     * docs/database/partitioning.md. Postgres requires any unique/primary
     * key on a partitioned table to include the partition key column,
     * hence the composite primary key (id, recorded_at) instead of a plain
     * `id` PK. `id` still comes from a single shared sequence, so it stays
     * globally unique across partitions in practice even though Postgres
     * doesn't enforce that itself for a composite key.
     *
     * Sampled (not raw) trip route history — populated by
     * App\Console\Commands\ConsumeLocationUpdates, which throttles how
     * often a point is durably stored. Raw, every-few-seconds GPS traffic
     * lives only in Kafka and Redis (see AGENTS.md: "Raw GPS pings are not
     * retained forever in PostgreSQL").
     */
    public function up(): void
    {
        DB::statement('
            CREATE TABLE trip_location_samples (
                id BIGSERIAL,
                uuid UUID NOT NULL DEFAULT gen_random_uuid(),
                trip_id BIGINT NOT NULL,
                driver_id BIGINT NOT NULL,
                location GEOGRAPHY(POINT, 4326) NOT NULL,
                speed_mps NUMERIC(6, 2),
                heading_degrees NUMERIC(5, 2),
                accuracy_meters NUMERIC(6, 2),
                recorded_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (id, recorded_at)
            ) PARTITION BY RANGE (recorded_at)
        ');

        DB::statement('ALTER TABLE trip_location_samples ADD CONSTRAINT trip_location_samples_trip_id_foreign FOREIGN KEY (trip_id) REFERENCES trips (id) ON DELETE CASCADE');
        DB::statement('ALTER TABLE trip_location_samples ADD CONSTRAINT trip_location_samples_driver_id_foreign FOREIGN KEY (driver_id) REFERENCES drivers (id) ON DELETE CASCADE');

        // Supports: "recent samples for this trip, in order" — the query
        // both the sampling-throttle check and any future route-rendering
        // endpoint will run.
        DB::statement('CREATE INDEX trip_location_samples_trip_id_recorded_at_idx ON trip_location_samples (trip_id, recorded_at)');

        // Supports: PostGIS queries over trip routes (heatmaps, corridor
        // analysis) per the brief's spatial design section. Created on the
        // parent so Postgres automatically creates a matching index on
        // every partition — including ones added after this migration runs
        // (see docs/database/partitioning.md).
        DB::statement('CREATE INDEX trip_location_samples_location_gist ON trip_location_samples USING GIST (location)');

        $this->createPartitionForMonth(now());
        $this->createPartitionForMonth(now()->addMonthNoOverflow());
    }

    public function down(): void
    {
        DB::statement('DROP TABLE IF EXISTS trip_location_samples CASCADE');
    }

    /**
     * Creates the monthly partition covering the given date, if it doesn't
     * already exist. See docs/database/partitioning.md for the operational
     * story around adding future partitions before local dev crosses a
     * month boundary.
     */
    private function createPartitionForMonth(Carbon $date): void
    {
        $start = $date->copy()->startOfMonth();
        $end = $start->copy()->addMonthNoOverflow();
        $partitionName = 'trip_location_samples_y'.$start->format('Y').'m'.$start->format('m');

        DB::statement(
            "CREATE TABLE IF NOT EXISTS {$partitionName} ".
            "PARTITION OF trip_location_samples ".
            "FOR VALUES FROM ('{$start->toDateString()}') TO ('{$end->toDateString()}')"
        );
    }
};
