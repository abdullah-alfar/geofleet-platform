<?php

namespace App\Support;

/**
 * Per-request correlation id, bound as a singleton by
 * App\Http\Middleware\AssignCorrelationId. Threaded through outbox event
 * envelopes and log context so a single request can be traced across API
 * logs, published Kafka events, and (eventually) downstream consumers.
 */
class CorrelationContext
{
    public function __construct(private readonly string $id) {}

    public function id(): string
    {
        return $this->id;
    }
}
