<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Idempotency ledger for Kafka consumers running inside core-api (e.g.
     * consuming ride.assigned.v1 / payment.completed.v1 back from the Go
     * services in a later phase). At-least-once delivery is assumed
     * everywhere (see AGENTS.md) — every consumer that causes a durable
     * state change records the event here, in the same transaction as the
     * state change, and skips events already present.
     */
    public function up(): void
    {
        Schema::create('inbox_events', function (Blueprint $table) {
            $table->id();

            $table->string('consumer_name');
            $table->uuid('event_id');

            $table->timestampTz('processed_at')->useCurrent();

            // Supports the idempotency check itself: "has `consumer_name`
            // already processed `event_id`?" — the whole point of this
            // table, so the unique constraint doubles as the lookup index.
            $table->unique(['consumer_name', 'event_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inbox_events');
    }
};
