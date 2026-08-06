<?php

namespace App\Contracts;

interface KafkaProducer
{
    /**
     * Publishes a single message and blocks until the broker has
     * acknowledged it (or throws). The outbox publisher processes a small
     * batch at a time, so synchronous-per-message delivery is simple and
     * correct rather than a throughput bottleneck — this is not the
     * high-frequency GPS path (that's location-service's Go producer).
     *
     * @param  array<string, string>  $headers
     */
    public function publish(string $topic, string $key, string $payload, array $headers = []): void;
}
