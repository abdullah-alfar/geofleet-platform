import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { CoreApiHealthIndicator } from './indicators/core-api.indicator';
import { KafkaHealthIndicator } from './indicators/kafka.indicator';
import { PostgresHealthIndicator } from './indicators/postgres.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';
import { HealthController } from './health.controller';

/**
 * PostgresHealthIndicator (`SELECT 1`) proves the shared pool can reach
 * Postgres as the `admin_api` role — the same connection auth
 * (Phase 2) and admin_read projections (Phase 3) both use. It doesn't
 * prove any specific table exists or is queryable; a broken migration
 * would surface as a query-time 500 from the endpoint that hits it, not
 * as a readiness failure — same tradeoff every other indicator here makes
 * (connectivity, not schema correctness).
 */
@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [HealthController],
  providers: [
    RedisHealthIndicator,
    KafkaHealthIndicator,
    CoreApiHealthIndicator,
    PostgresHealthIndicator,
  ],
})
export class HealthModule {}
