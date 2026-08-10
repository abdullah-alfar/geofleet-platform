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
 * Consumes driver.location.validated.v1.retry — the isolated, backoff-
 * delayed second chance for messages ConsumeLocationUpdates couldn't
 * process after its fast local retries. See
 * docs/decisions/0007-retry-dlq-strategy.md and docs/events/retry-and-dlq.md.
 *
 * Deliberately a SEPARATE process from ConsumeLocationUpdates, not another
 * topic on the same consumer: this command sleeps up to 10 minutes between
 * attempts (BACKOFF_SCHEDULE), and that must never block fresh GPS traffic
 * on the main topic.
 *
 * Uses the exact same idempotent core (App\Domain\Location\LocationUpdateProcessor)
 * as the main consumer, and the same inbox consumer_name — the two
 * processes are the same logical consumer split across two topics, so a
 * message that a retry attempt successfully processes is recorded exactly
 * the way the fast path would have recorded it.
 */
class ConsumeLocationUpdatesRetry extends Command
{
    protected $signature = 'kafka:consume-location-updates-retry';

    protected $description = 'Consumes driver.location.validated.v1.retry with a backoff-delayed reattempt, escalating to the DLQ on exhaustion.';

    private const MAIN_TOPIC = 'driver.location.validated.v1';

    private const RETRY_TOPIC = self::MAIN_TOPIC.'.retry';

    private const DLQ_TOPIC = self::MAIN_TOPIC.'.dlq';

    /** Seconds to sleep before each reattempt, indexed by (attempt - 1). Its length is also the max retry-topic attempts before DLQ. */
    private const BACKOFF_SECONDS = [30, 120, 600];

    private bool $shouldStop = false;

    public function handle(KafkaProducer $producer): int
    {
        $inboxConsumerName = config('location.consumer_group');
        $kafkaGroupId = $inboxConsumerName.'-retry';

        $conf = new Conf();
        $conf->set('group.id', $kafkaGroupId);
        $conf->set('metadata.broker.list', config('kafka.brokers'));
        $conf->set('enable.auto.commit', 'false');
        $conf->set('auto.offset.reset', 'earliest');

        $consumer = new KafkaConsumer($conf);
        $consumer->subscribe([self::RETRY_TOPIC]);

        $this->installSignalHandlers();

        $processor = new LocationUpdateProcessor(new LocationSampler(
            minIntervalSeconds: config('location.sample_min_interval_seconds'),
            minDistanceMeters: config('location.sample_min_distance_meters'),
        ));

        Log::info('location_retry_consumer.started', ['topic' => self::RETRY_TOPIC, 'group' => $kafkaGroupId]);
        $this->info("Consuming {$kafkaGroupId} <- ".self::RETRY_TOPIC.' (Ctrl+C to stop)');

        while (! $this->shouldStop) {
            $message = $consumer->consume(1000);

            switch ($message->err) {
                case RD_KAFKA_RESP_ERR_NO_ERROR:
                    $this->processMessage($message, $processor, $inboxConsumerName, $producer);
                    $consumer->commit($message);
                    break;

                case RD_KAFKA_RESP_ERR__PARTITION_EOF:
                case RD_KAFKA_RESP_ERR__TIMED_OUT:
                    break;

                default:
                    Log::error('location_retry_consumer.kafka_error', [
                        'error' => $message->errstr(),
                        'code' => $message->err,
                    ]);
            }
        }

        Log::info('location_retry_consumer.stopped');
        $this->info('Consumer stopped.');

        return self::SUCCESS;
    }

    private function processMessage(\RdKafka\Message $message, LocationUpdateProcessor $processor, string $inboxConsumerName, KafkaProducer $producer): void
    {
        try {
            $retryEnvelope = RetryEnvelope::fromJson($message->payload);
        } catch (Throwable $e) {
            Log::error('location_retry_consumer.malformed_retry_envelope', [
                'raw' => $message->payload,
                'error' => $e->getMessage(),
            ]);
            return;
        }

        $envelope = $retryEnvelope->payload;

        app()->instance(CorrelationContext::class, new CorrelationContext(
            $envelope['correlation_id'] ?? $envelope['event_id'] ?? $retryEnvelope->firstFailedAt
        ));

        $this->sleepBackoff($retryEnvelope->attempt);

        try {
            $processor->process($envelope, $inboxConsumerName);

            Log::info('location_retry_consumer.processed', [
                'event_id' => $envelope['event_id'] ?? null,
                'attempt' => $retryEnvelope->attempt,
            ]);
        } catch (Throwable $e) {
            if ($retryEnvelope->attempt >= count(self::BACKOFF_SECONDS)) {
                Log::error('location_retry_consumer.attempts_exhausted', [
                    'event_id' => $envelope['event_id'] ?? null,
                    'attempts' => $retryEnvelope->attempt,
                    'error' => $e->getMessage(),
                ]);
                $this->publishTo(self::DLQ_TOPIC, $message, $retryEnvelope->withError($e->getMessage()), $producer);

                return;
            }

            Log::warning('location_retry_consumer.attempt_failed_reenqueueing', [
                'event_id' => $envelope['event_id'] ?? null,
                'next_attempt' => $retryEnvelope->attempt + 1,
                'error' => $e->getMessage(),
            ]);
            $this->publishTo(self::RETRY_TOPIC, $message, $retryEnvelope->withNextAttempt($e->getMessage()), $producer);
        }
    }

    private function sleepBackoff(int $attempt): void
    {
        $idx = max(0, min($attempt - 1, count(self::BACKOFF_SECONDS) - 1));
        sleep(self::BACKOFF_SECONDS[$idx]);
    }

    private function publishTo(string $topic, \RdKafka\Message $message, RetryEnvelope $envelope, KafkaProducer $producer): void
    {
        try {
            $producer->publish(
                topic: $topic,
                key: (string) $message->key,
                payload: $envelope->toJson(),
            );
        } catch (Throwable $e) {
            Log::error('location_retry_consumer.publish_failed', [
                'topic' => $topic,
                'error' => $e->getMessage(),
            ]);
        }
    }

    private function installSignalHandlers(): void
    {
        pcntl_async_signals(true);

        $handler = function (int $signal) {
            Log::info('location_retry_consumer.shutdown_signal_received', ['signal' => $signal]);
            $this->shouldStop = true;
        };

        pcntl_signal(SIGTERM, $handler);
        pcntl_signal(SIGINT, $handler);
    }
}
