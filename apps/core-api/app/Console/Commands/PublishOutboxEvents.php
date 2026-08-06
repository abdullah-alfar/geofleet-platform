<?php

namespace App\Console\Commands;

use App\Contracts\KafkaProducer;
use App\Models\OutboxEvent;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Transactional outbox publisher (see AGENTS.md and
 * docs/decisions/0001-kafka-over-alternative-queues.md).
 *
 * Intended to run on a short interval (e.g. every few seconds via a
 * scheduled task or a simple `while true; do artisan outbox:publish; sleep
 * 2; done` loop in local dev). Debezium/CDC could replace this polling
 * approach later without changing the outbox_events schema or the Kafka
 * topics it writes to — see docs/decisions for that trade-off.
 */
class PublishOutboxEvents extends Command
{
    protected $signature = 'outbox:publish {--batch=100 : Maximum number of events to publish per run}';

    protected $description = 'Publishes unpublished outbox_events rows to Kafka.';

    public function handle(KafkaProducer $producer): int
    {
        $batchSize = max(1, (int) $this->option('batch'));
        $published = 0;
        $failed = 0;

        // The row lock is held for the entire select-publish-mark sequence,
        // not just the select: this is what actually prevents two publisher
        // instances from both sending the same event ("Avoids multiple
        // publishers sending the same event unnecessarily" — brief). The
        // trade-off is a DB connection held open across the Kafka I/O call;
        // acceptable at this batch size and publish frequency. If the
        // process dies mid-batch, the whole transaction rolls back and
        // already-published events are retried — a duplicate Kafka publish
        // the system already assumes (at-least-once delivery, idempotent
        // consumers — see AGENTS.md).
        DB::transaction(function () use ($producer, $batchSize, &$published, &$failed) {
            $events = OutboxEvent::whereNull('published_at')
                ->oldest('created_at')
                ->limit($batchSize)
                ->lock('FOR UPDATE SKIP LOCKED')
                ->get();

            foreach ($events as $event) {
                $topic = "{$event->event_type}.v{$event->event_version}";

                try {
                    $producer->publish(
                        topic: $topic,
                        // The aggregate id is always the entity the topic's
                        // key selection maps to (ride_request_id, trip_id,
                        // driver_id, payment_id — see
                        // docs/events/topic-catalog.md), so it doubles
                        // directly as the Kafka partition key.
                        key: $event->aggregate_id,
                        payload: json_encode($event->payload, JSON_THROW_ON_ERROR),
                        headers: array_map(static fn ($value) => (string) $value, $event->headers ?? []),
                    );

                    $event->forceFill(['published_at' => now(), 'last_error' => null])->save();
                    $published++;

                    Log::info('outbox.published', [
                        'event_id' => $event->event_id,
                        'event_type' => $event->event_type,
                        'topic' => $topic,
                        'aggregate_id' => $event->aggregate_id,
                    ]);
                } catch (Throwable $e) {
                    $event->increment('attempts');
                    $event->forceFill(['last_error' => substr($e->getMessage(), 0, 2000)])->save();
                    $failed++;

                    Log::error('outbox.publish_failed', [
                        'event_id' => $event->event_id,
                        'event_type' => $event->event_type,
                        'topic' => $topic,
                        'attempts' => $event->attempts,
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        });

        $this->info("Published {$published} event(s), {$failed} failed.");

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}
