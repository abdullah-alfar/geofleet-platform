import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * The Phase 1 RedisHealthIndicator's client is deliberately private and
 * `lazyConnect` — a ping-only, disposable connection. This one is
 * persistent: Phase 7's realtime module issues real read traffic
 * (`MGET dispatch:driver:{id}`) on every request, so a connect-per-call
 * client would add unnecessary latency. Read-only in practice — nothing
 * in admin-api ever writes to Redis, only reads state the Go services
 * already maintain (see docs/admin-api/realtime-operations.md).
 */
@Injectable()
class AdminApiRedisClient implements OnModuleDestroy {
  private readonly logger = new Logger(AdminApiRedisClient.name);
  readonly client: Redis;

  constructor(config: ConfigService<AppConfig, true>) {
    const redis = config.get('redis', { infer: true });
    this.client = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password || undefined,
      maxRetriesPerRequest: 2,
    });

    // Same lesson as AdminApiPgPool (integrations/postgres/postgres.module.ts)
    // and the Phase 1 Redis health indicator — an ioredis client emits
    // 'error' on connection issues, and an unlistened 'error' event is
    // fatal to the whole Node process, not just the failing call.
    this.client.on('error', (err: Error) => {
      this.logger.error('Redis client error', err.stack);
    });
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}

@Global()
@Module({
  providers: [
    AdminApiRedisClient,
    {
      provide: REDIS_CLIENT,
      inject: [AdminApiRedisClient],
      useFactory: (holder: AdminApiRedisClient): Redis => holder.client,
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
