import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { CoreApiHealthIndicator } from './indicators/core-api.indicator';
import { KafkaHealthIndicator } from './indicators/kafka.indicator';
import { PostgresHealthIndicator } from './indicators/postgres.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';
import { HealthController } from './health.controller';

/**
 * PostgresHealthIndicator checks the `admin_api` role's connection only
 * (personal_access_tokens/users/admins — authentication, Phase 2). It does
 * NOT prove the admin_read schema/projections are healthy — those don't
 * exist until Phase 3, on a separate connection/role once built.
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
