import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CompressionCodecs, CompressionTypes, Consumer, Kafka } from 'kafkajs';
import SnappyCodec from 'kafkajs-snappy';
import { AppConfig } from '../../config/configuration';
import { ProjectionDispatcherService } from '../../projections/projection-dispatcher.service';
import { parseEnvelope } from './envelope';
import { ADMIN_API_KAFKA_TOPICS } from './topics';

// Both Go producers (dispatch-service, location-service) publish with
// Snappy-compressed batches (kgo.ProducerBatchCompression(kgo.SnappyCompression())
// — see their internal/kafka/producer.go). kafkajs only ships gzip
// support out of the box; without this registration the consumer crashes
// the instant it fetches a Snappy-compressed batch (caught live: it
// joined the consumer group successfully, then crashed on its first
// fetch — "Snappy compression not implemented"). Must run before any
// Kafka/Consumer instance is constructed.
CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec;

@Injectable()
export class KafkaConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaConsumerService.name);
  private readonly consumer: Consumer;
  private readonly groupId: string;

  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly dispatcher: ProjectionDispatcherService,
  ) {
    const kafkaConfig = config.get('kafka', { infer: true });
    this.groupId = kafkaConfig.consumerGroup;

    const kafka = new Kafka({
      clientId: 'admin-api',
      brokers: kafkaConfig.brokers,
      // High retry count, not the kafkajs default (5) — a broker outage
      // at admin-api's own startup must not stop the HTTP API from
      // coming up (see onModuleInit below: connect/subscribe/run is
      // fire-and-forget, never awaited by Nest's bootstrap), and it
      // should keep trying to reconnect for as long as the process runs,
      // not give up after a handful of attempts. Same "REST API keeps
      // serving, consumers reconnect automatically" requirement as this
      // service's own Failure Handling design.
      retry: { retries: 100, maxRetryTime: 30_000 },
    });
    this.consumer = kafka.consumer({ groupId: this.groupId });
  }

  onModuleInit(): void {
    // Deliberately not awaited — see the retry comment above. Nest's
    // bootstrap (and therefore app.listen()) must not block on Kafka
    // being reachable.
    void this.startConsuming();
  }

  private async startConsuming(): Promise<void> {
    try {
      await this.consumer.connect();
      await Promise.all(
        ADMIN_API_KAFKA_TOPICS.map((topic) =>
          this.consumer.subscribe({ topic, fromBeginning: true }),
        ),
      );

      await this.consumer.run({
        eachMessage: async ({ topic, message }) => {
          try {
            const envelope = parseEnvelope(message.value);
            await this.dispatcher.dispatch(envelope);
          } catch (error) {
            // Best-effort, self-healing projections — same reasoning
            // ADR 0007 already applies to dispatch-service's location/
            // status consumers: every table here is continuously
            // upserted by later events for the same entity, so one
            // dropped event is not "unrecoverable data loss." Logged and
            // skipped so a single bad message never blocks the whole
            // partition (kafkajs would otherwise redeliver the same
            // message forever if eachMessage keeps throwing).
            this.logger.error(
              `Failed to process message on topic "${topic}": ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        },
      });

      this.logger.log(
        `Kafka consumer running: group "${this.groupId}", ${ADMIN_API_KAFKA_TOPICS.length} topics.`,
      );
    } catch (error) {
      this.logger.error(
        `Kafka consumer failed to start: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.consumer.disconnect();
  }
}
