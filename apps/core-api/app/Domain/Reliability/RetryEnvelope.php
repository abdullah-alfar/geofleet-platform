<?php

namespace App\Domain\Reliability;

/**
 * Wraps a Kafka message that failed processing, for publication onto
 * "{topic}.retry" or "{topic}.dlq" (see docs/decisions/0007-retry-dlq-strategy.md
 * and docs/events/retry-and-dlq.md). Deliberately NOT the standard event
 * envelope (docs/events/event-envelope.md) — `payload` carries that
 * envelope, decoded, so a replayed message reproduces the original
 * content exactly. Field names match apps/dispatch-service's Go
 * RetryEnvelope (internal/reliability) so the same replay tooling
 * (scripts/kafka-replay-dlq.sh) works for either language's DLQ topics.
 */
final class RetryEnvelope
{
    public function __construct(
        public readonly string $originalTopic,
        public readonly int $attempt,
        public readonly string $firstFailedAt,
        public readonly string $lastError,
        public readonly array $payload,
    ) {}

    public static function first(string $originalTopic, string $lastError, array $payload): self
    {
        return new self(
            originalTopic: $originalTopic,
            attempt: 1,
            firstFailedAt: now()->toISOString(),
            lastError: $lastError,
            payload: $payload,
        );
    }

    public function withNextAttempt(string $lastError): self
    {
        return new self(
            originalTopic: $this->originalTopic,
            attempt: $this->attempt + 1,
            firstFailedAt: $this->firstFailedAt,
            lastError: $lastError,
            payload: $this->payload,
        );
    }

    public function withError(string $lastError): self
    {
        return new self(
            originalTopic: $this->originalTopic,
            attempt: $this->attempt,
            firstFailedAt: $this->firstFailedAt,
            lastError: $lastError,
            payload: $this->payload,
        );
    }

    public static function fromJson(string $json): self
    {
        $data = json_decode($json, associative: true, flags: JSON_THROW_ON_ERROR);

        return new self(
            originalTopic: $data['original_topic'],
            attempt: $data['attempt'],
            firstFailedAt: $data['first_failed_at'],
            lastError: $data['last_error'],
            payload: $data['payload'],
        );
    }

    public function toJson(): string
    {
        return json_encode([
            'original_topic' => $this->originalTopic,
            'attempt' => $this->attempt,
            'first_failed_at' => $this->firstFailedAt,
            'last_error' => $this->lastError,
            'payload' => $this->payload,
        ], JSON_THROW_ON_ERROR);
    }
}
