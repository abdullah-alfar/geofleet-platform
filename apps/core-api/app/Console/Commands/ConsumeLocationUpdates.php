<?php

namespace App\Console\Commands;

use App\Contracts\KafkaProducer;
use App\Domain\Location\LocationSampler;
use App\Domain\Location\LocationUpdateProcessor;
use App\Domain\Reliability\RetryEnvelope;
use App\Support\CorrelationContext;
use Illuminate\Console\Command;
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
 * as that state change. See App\Domain\Location\LocationUpdateProcessor,
 * shared with the retry-topic consumer below.
 *
 * A message that fails processing after MAX_ATTEMPTS fast local retries is
 * NOT just logged and dropped (that was a Phase 4-era placeholder — see
 * git history) — it's published to driver.location.validated.v1.retry for
 * an isolated, backoff-delayed reattempt by
 * App\Console\Commands\ConsumeLocationUpdatesRetry. See
 * docs/decisions/0007-retry-dlq-strategy.md and docs/events/retry-and-dlq.md.
 */
class ConsumeLocationUpdates extends Command
{
    protected $signature = 'kafka:consume-location-updates';

    protected $description = 'Consumes driver.location.validated.v1 and samples trip routes.';

    private const TOPIC = 'driver.location.validated.v1';

    private const MAX_ATTEMPTS = 3;

    private bool $shouldStop = false;

    public function handle(KafkaProducer $producer): int
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

        $processor = new LocationUpdateProcessor(new LocationSampler(
            minIntervalSeconds: config('location.sample_min_interval_seconds'),
            minDistanceMeters: config('location.sample_min_distance_meters'),
        ));

        Log::info('location_consumer.started', ['topic' => self::TOPIC, 'group' => $consumerGroup]);
        $this->info("Consuming {$consumerGroup} <- ".self::TOPIC.' (Ctrl+C to stop)');

        while (! $this->shouldStop) {
            $message = $consumer->consume(1000);

            switch ($message->err) {
                case RD_KAFKA_RESP_ERR_NO_ERROR:
                    $this->processMessage($message, $processor, $consumerGroup, $producer);
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

    private function processMessage(\RdKafka\Message $message, LocationUpdateProcessor $processor, string $consumerGroup, KafkaProducer $producer): void
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
        $lastError = null;

        while (true) {
            $attempt++;

            try {
                $processor->process($envelope, $consumerGroup);

                Log::info('location_consumer.processed', [
                    'event_id' => $envelope['event_id'],
                    'correlation_id' => $envelope['correlation_id'] ?? null,
                    'duration_ms' => (int) ((microtime(true) - $start) * 1000),
                ]);
                return;
            } catch (Throwable $e) {
                $lastError = $e->getMessage();

                if ($attempt >= self::MAX_ATTEMPTS) {
                    Log::error('location_consumer.processing_failed', [
                        'event_id' => $envelope['event_id'],
                        'attempts' => $attempt,
                        'error' => $lastError,
                    ]);

                    $this->routeToRetryTopic($envelope, $message, $lastError, $producer);
                    return; // offset still commits — the retry topic owns it now
                }

                usleep(200_000 * $attempt); // short backoff: 200ms, 400ms
            }
        }
    }

    private function routeToRetryTopic(array $envelope, \RdKafka\Message $message, string $lastError, KafkaProducer $producer): void
    {
        $retryEnvelope = RetryEnvelope::first(self::TOPIC, $lastError, $envelope);

        try {
            $producer->publish(
                topic: self::TOPIC.'.retry',
                key: (string) $message->key,
                payload: $retryEnvelope->toJson(),
            );
        } catch (Throwable $e) {
            // Nowhere else for this message to go — log loudly so it's not
            // silently lost. A future replay would need to come from
            // whatever alerting picks up this log line, since it never
            // made it to a retry/DLQ topic at all.
            Log::error('location_consumer.retry_publish_failed', [
                'event_id' => $envelope['event_id'],
                'error' => $e->getMessage(),
            ]);
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
