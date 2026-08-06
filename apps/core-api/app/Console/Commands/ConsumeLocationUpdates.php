<?php

namespace App\Console\Commands;

use App\Domain\Location\LocationSampler;
use App\Models\InboxEvent;
use App\Support\CorrelationContext;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RdKafka\Conf;
use RdKafka\KafkaConsumer;
use Throwable;

/**
 * Consumes driver.location.validated.v1 (produced by
 * apps/location-service) and performs the durable, trip-scoped work that
 * doesn't belong on the Go GPS-ingestion hot path: sampling points into
 * trip_location_samples and re-keying them into trip.location.updated.v1
 * for realtime-gateway (see App\Domain\Location\LocationSampler).
 *
 * At-least-once delivery is assumed (AGENTS.md) — every message is
 * deduplicated via the inbox pattern (inbox_events, unique on
 * consumer_name+event_id) before any state change, in the same transaction
 * as that state change.
 *
 * Retry/DLQ topics are a Phase 7 concern (AGENTS.md: don't build ahead of
 * schedule). For now, a message that fails processing after a few local
 * retries is logged as an error and skipped (offset committed anyway) —
 * better than one poison message blocking this consumer forever with
 * nowhere else for it to go yet.
 */
class ConsumeLocationUpdates extends Command
{
    protected $signature = 'kafka:consume-location-updates';

    protected $description = 'Consumes driver.location.validated.v1 and samples trip routes.';

    private const TOPIC = 'driver.location.validated.v1';

    private const MAX_ATTEMPTS = 3;

    private bool $shouldStop = false;

    public function handle(): int
    {
        $consumerGroup = config('location.consumer_group');

        $conf = new Conf();
        $conf->set('group.id', $consumerGroup);
        $conf->set('metadata.broker.list', config('kafka.brokers'));
        $conf->set('enable.auto.commit', 'false');
        $conf->set('auto.offset.reset', 'earliest');

        $consumer = new KafkaConsumer($conf);
        $consumer->subscribe([self::TOPIC]);

        $this->installSignalHandlers();

        $sampler = new LocationSampler(
            minIntervalSeconds: config('location.sample_min_interval_seconds'),
            minDistanceMeters: config('location.sample_min_distance_meters'),
        );

        Log::info('location_consumer.started', ['topic' => self::TOPIC, 'group' => $consumerGroup]);
        $this->info("Consuming {$consumerGroup} <- ".self::TOPIC.' (Ctrl+C to stop)');

        while (! $this->shouldStop) {
            $message = $consumer->consume(1000);

            switch ($message->err) {
                case RD_KAFKA_RESP_ERR_NO_ERROR:
                    $this->processMessage($message, $sampler, $consumerGroup);
                    $consumer->commit($message);
                    break;

                case RD_KAFKA_RESP_ERR__PARTITION_EOF:
                case RD_KAFKA_RESP_ERR__TIMED_OUT:
                    break;

                default:
                    Log::error('location_consumer.kafka_error', [
                        'error' => $message->errstr(),
                        'code' => $message->err,
                    ]);
            }
        }

        Log::info('location_consumer.stopped');
        $this->info('Consumer stopped.');

        return self::SUCCESS;
    }

    private function processMessage(\RdKafka\Message $message, LocationSampler $sampler, string $consumerGroup): void
    {
        $start = microtime(true);

        $envelope = json_decode($message->payload, associative: true);
        if (! is_array($envelope) || ! isset($envelope['event_id'])) {
            Log::error('location_consumer.malformed_message', ['raw' => $message->payload]);
            return;
        }

        app()->instance(CorrelationContext::class, new CorrelationContext(
            $envelope['correlation_id'] ?? $envelope['event_id']
        ));

        $attempt = 0;

        while (true) {
            $attempt++;

            try {
                DB::transaction(function () use ($envelope, $sampler, $consumerGroup) {
                    if (InboxEvent::where('consumer_name', $consumerGroup)
                        ->where('event_id', $envelope['event_id'])
                        ->exists()) {
                        return; // already processed — redelivery, safe no-op
                    }

                    InboxEvent::create([
                        'consumer_name' => $consumerGroup,
                        'event_id' => $envelope['event_id'],
                    ]);

                    $sampler->handle($envelope['data'], $envelope['event_id']);
                });

                Log::info('location_consumer.processed', [
                    'event_id' => $envelope['event_id'],
                    'correlation_id' => $envelope['correlation_id'] ?? null,
                    'duration_ms' => (int) ((microtime(true) - $start) * 1000),
                ]);
                return;
            } catch (Throwable $e) {
                if ($attempt >= self::MAX_ATTEMPTS) {
                    Log::error('location_consumer.processing_failed', [
                        'event_id' => $envelope['event_id'],
                        'attempts' => $attempt,
                        'error' => $e->getMessage(),
                    ]);
                    return; // give up on this message; offset still commits
                }

                usleep(200_000 * $attempt); // short backoff: 200ms, 400ms
            }
        }
    }

    private function installSignalHandlers(): void
    {
        pcntl_async_signals(true);

        $handler = function (int $signal) {
            Log::info('location_consumer.shutdown_signal_received', ['signal' => $signal]);
            $this->shouldStop = true;
        };

        pcntl_signal(SIGTERM, $handler);
        pcntl_signal(SIGINT, $handler);
    }
}
