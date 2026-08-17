import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { PostgresHealthIndicator } from './indicators/postgres.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';
import { HealthController } from './health.controller';

/**
 * PostgresHealthIndicator (`SELECT 1`) proves the shared pool can reach
 * Postgres as the (now broadened) `admin_api` role — see
 * docs/decisions/0011-admin-api-independent-service.md. No CoreApiHealthIndicator
 * anymore — admin-api has no runtime dependency on core-api at all. No
 * KafkaHealthIndicator — admin-api doesn't run a Kafka consumer.
 */
@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [RedisHealthIndicator, PostgresHealthIndicator],
})
export class HealthModule {}
