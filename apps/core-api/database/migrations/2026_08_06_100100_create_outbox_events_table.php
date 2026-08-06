<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Transactional outbox: domain writes and the corresponding
     * outbox_events row are committed in the same PostgreSQL transaction
     * (see App\Domain\Outbox\Outbox and AGENTS.md). A separate publisher
     * process (outbox:publish) reads unpublished rows and sends them to
     * Kafka, marking published_at on success.
     */
    public function up(): void
    {
        Schema::create('outbox_events', function (Blueprint $table) {
            $table->id();

            // The event envelope's own id (also the Kafka message's logical
            // identity for consumer-side idempotency) — distinct from the
            // row's internal `id`.
            $table->uuid('event_id')->unique()->default(DB::raw('gen_random_uuid()'));

            $table->string('aggregate_type');
            $table->uuid('aggregate_id');

            $table->string('event_type');
            $table->unsignedSmallInteger('event_version')->default(1);

            // Full envelope body (see docs/events/event-envelope.md) and any
            // transport-level headers (e.g. correlation_id duplicated for
            // header-based tracing) as jsonb.
            $table->jsonb('payload');
            $table->jsonb('headers')->nullable();

            $table->timestampTz('occurred_at');
            $table->timestampTz('published_at')->nullable();

            $table->unsignedInteger('attempts')->default(0);
            $table->text('last_error')->nullable();

            $table->timestampTz('created_at')->useCurrent();
        });

        Schema::table('outbox_events', function (Blueprint $table) {
            // Supports: "all events for this aggregate" debugging/replay
            // lookups.
            $table->index(['aggregate_type', 'aggregate_id']);
        });

        // Supports the publisher's core query: "select unpublished events,
        // oldest first". A partial index (rather than a plain composite
        // index on published_at+created_at) keeps it small indefinitely,
        // since published rows — the overwhelming majority over time — are
        // excluded from it entirely.
        DB::statement('CREATE INDEX outbox_events_unpublished_idx ON outbox_events (created_at) WHERE published_at IS NULL');
    }

    public function down(): void
    {
        Schema::dropIfExists('outbox_events');
    }
};
