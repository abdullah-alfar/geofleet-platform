import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class RedisHealthIndicator implements OnModuleDestroy {
  private readonly client: Redis;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    config: ConfigService<AppConfig, true>,
  ) {
    const redis = config.get('redis', { infer: true });
    // lazyConnect: a health-check-only client should never hold a socket
    // open when nobody's asking — it connects on first ping, same
    // philosophy as the Go services' short-lived readiness Pinger calls.
    this.client = new Redis({
      host: redis.host,
      port: redis.port,
      password: redis.password || undefined,
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
    });
    this.client.on('error', () => {
      // Swallow — ping() below surfaces the failure to the readiness check.
      // An unhandled 'error' event on an ioredis client crashes the process.
    });
  }

  async check(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await this.client.connect().catch(() => undefined);
      // Declared `string`, not ioredis's literal `"PONG"` return type — a
      // narrower type would make the guard below type-check as dead code,
      // even though at runtime a misbehaving server could return anything.
      const reply: string = await this.client.ping();
      if (reply !== 'PONG') {
        throw new Error(`unexpected PING reply: ${reply}`);
      }
      return indicator.up();
    } catch (error) {
      return indicator.down({
        message: error instanceof Error ? error.message : 'unreachable',
      });
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
