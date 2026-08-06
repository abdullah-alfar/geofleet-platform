<?php

namespace App\Infrastructure\Kafka;

use App\Contracts\KafkaProducer;
use RdKafka\Conf;
use RdKafka\Producer;
use RuntimeException;

/**
 * franz-go is used for the Go services; ext-rdkafka (wrapping librdkafka —
 * the same underlying C library) is the mature equivalent for PHP, and is
 * already present on this host (see docs/decisions).
 */
class RdKafkaProducer implements KafkaProducer
{
    private Producer $producer;

    public function __construct(string $brokers)
    {
        $conf = new Conf();
        $conf->set('metadata.broker.list', $brokers);

        // Local dev has no Kafka authentication configured. Production
        // deployments set security.protocol / sasl.* here without changing
        // any call site (AGENTS.md: "Kafka authentication-ready configuration").

        $this->producer = new Producer($conf);
    }

    public function publish(string $topic, string $key, string $payload, array $headers = []): void
    {
        $kafkaTopic = $this->producer->newTopic($topic);

        $kafkaTopic->producev(
            partition: RD_KAFKA_PARTITION_UA,
            msgflags: 0,
            payload: $payload,
            key: $key,
            headers: $headers,
        );

        $this->producer->poll(0);

        $result = $this->producer->flush(10000);

        if ($result !== RD_KAFKA_RESP_ERR_NO_ERROR) {
            throw new RuntimeException(
                "Kafka publish to topic '{$topic}' failed to flush (error code {$result})."
            );
        }
    }
}
