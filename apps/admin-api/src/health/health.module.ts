import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { CoreApiHealthIndicator } from './indicators/core-api.indicator';
import { PostgresHealthIndicator } from './indicators/postgres.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';
import { HealthController } from './health.controller';

/**
 * PostgresHealthIndicator (`SELECT 1`) proves the shared pool can reach
 * Postgres as the `admin_api` role (auth-only — see
 * docs/decisions/0009-admin-identity.md; the admin_read schema this role
 * once also owned for Kafka projections is gone, see
 * docs/admin-api/query-apis.md). No KafkaHealthIndicator anymore — admin-api
 * doesn't run a Kafka consumer at all.
 */
@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [HealthController],
  providers: [
    RedisHealthIndicator,
    CoreApiHealthIndicator,
    PostgresHealthIndicator,
  ],
})
export class HealthModule {}
