import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import { Kafka } from 'kafkajs';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class KafkaHealthIndicator implements OnModuleDestroy {
  private readonly kafka: Kafka;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.kafka = new Kafka({
      clientId: 'admin-api-health',
      brokers: config.get('kafka', { infer: true }).brokers,
      connectionTimeout: 2000,
      requestTimeout: 2000,
      retry: { retries: 0 },
      logLevel: 1, // kafkajs logLevel.ERROR — health checks shouldn't spam INFO logs
    });
  }

  async check(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      // Cheapest real round-trip to the broker that proves it's actually
      // answering requests, not just accepting TCP connections.
      await admin.listTopics();
      return indicator.up();
    } catch (error) {
      return indicator.down({
        message: error instanceof Error ? error.message : 'unreachable',
      });
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  onModuleDestroy(): void {
    // No persistent connection held between checks — nothing to tear down.
  }
}
