<?php

namespace App\Domain\Location;

use App\Models\InboxEvent;
use Illuminate\Support\Facades\DB;

/**
 * The idempotent-processing core shared by App\Console\Commands\ConsumeLocationUpdates
 * (the fast path — driver.location.validated.v1) and
 * ConsumeLocationUpdatesRetry (the isolated, backoff-delayed retry-topic
 * path — driver.location.validated.v1.retry, see
 * docs/decisions/0007-retry-dlq-strategy.md). Both processes are really
 * the same logical consumer split across two topics, so they share this
 * one implementation rather than risking the inbox-check/sampler logic
 * drifting out of sync between two copies.
 *
 * Throws on failure — callers decide what "failure" means (fast inline
 * retry, retry-topic escalation, DLQ).
 */
class LocationUpdateProcessor
{
    public function __construct(private readonly LocationSampler $sampler) {}

    /**
     * @param  array{event_id: string, correlation_id?: string, data: array}  $envelope
     */
    public function process(array $envelope, string $consumerGroup): void
    {
        DB::transaction(function () use ($envelope, $consumerGroup) {
            if (InboxEvent::where('consumer_name', $consumerGroup)
                ->where('event_id', $envelope['event_id'])
                ->exists()) {
                return; // already processed — redelivery or a successful retry-topic replay, safe no-op
            }

            InboxEvent::create([
                'consumer_name' => $consumerGroup,
                'event_id' => $envelope['event_id'],
            ]);

            $this->sampler->handle($envelope['data'], $envelope['event_id']);
        });
    }
}
