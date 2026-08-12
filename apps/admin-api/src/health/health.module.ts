import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { CoreApiHealthIndicator } from './indicators/core-api.indicator';
import { KafkaHealthIndicator } from './indicators/kafka.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';
import { HealthController } from './health.controller';

/**
 * No PostgresHealthIndicator here on purpose: admin-api has no Postgres
 * role or schema of its own until Phase 3 (Admin Read Database) creates
 * `admin_api`/`admin_read`. Wiring a health check against a connection
 * that doesn't exist yet would be exactly the kind of untested,
 * unverifiable code this repo's own conventions (see
 * docs/architecture/data-flow.md's note on trip.location.updated.v1) argue
 * against. Add it here the same phase the database module lands.
 */
@Module({
  imports: [TerminusModule, HttpModule],
  controllers: [HealthController],
  providers: [
    RedisHealthIndicator,
    KafkaHealthIndicator,
    CoreApiHealthIndicator,
  ],
})
export class HealthModule {}
