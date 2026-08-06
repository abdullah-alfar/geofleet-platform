<?php

namespace App\Domain\Outbox;

use App\Models\OutboxEvent;
use App\Support\CorrelationContext;
use Illuminate\Support\Facades\App;
use Illuminate\Support\Str;

/**
 * Writes an outbox_events row carrying the standard event envelope (see
 * docs/events/event-envelope.md).
 *
 * Callers MUST invoke this inside the same DB::transaction() as the domain
 * write it accompanies — that atomicity is the entire point of the
 * transactional outbox pattern (see AGENTS.md and ADR context). This class
 * does not open its own transaction so it composes into the caller's.
 *
 * Publishing to Kafka happens later, out-of-band, via `php artisan
 * outbox:publish` (App\Console\Commands\PublishOutboxEvents).
 */
class Outbox
{
    public static function record(
        string $aggregateType,
        string $aggregateId,
        string $eventType,
        int $eventVersion,
        array $data,
        ?string $regionId = null,
        ?string $causationId = null,
    ): OutboxEvent {
        $eventId = (string) Str::uuid();
        $occurredAt = now();

        $envelope = [
            'event_id' => $eventId,
            'event_type' => $eventType,
            'event_version' => $eventVersion,
            'occurred_at' => $occurredAt->toISOString(),
            'producer' => config('events.producer'),
            'correlation_id' => self::correlationId(),
            'causation_id' => $causationId,
            'aggregate_type' => $aggregateType,
            'aggregate_id' => $aggregateId,
            'region_id' => $regionId ?? config('events.default_region_id'),
            'data' => $data,
        ];

        return OutboxEvent::create([
            'event_id' => $eventId,
            'aggregate_type' => $aggregateType,
            'aggregate_id' => $aggregateId,
            'event_type' => $eventType,
            'event_version' => $eventVersion,
            'payload' => $envelope,
            'headers' => [
                'correlation_id' => $envelope['correlation_id'],
            ],
            'occurred_at' => $occurredAt,
        ]);
    }

    private static function correlationId(): string
    {
        if (App::bound(CorrelationContext::class)) {
            return App::make(CorrelationContext::class)->id();
        }

        // Falls back to a fresh id for non-HTTP contexts (e.g. artisan
        // commands, queued jobs) where AssignCorrelationId never ran.
        return (string) Str::uuid();
    }
}
