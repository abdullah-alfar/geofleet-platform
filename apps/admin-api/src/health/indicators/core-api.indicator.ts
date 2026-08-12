import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HealthIndicatorService } from '@nestjs/terminus';
import { firstValueFrom } from 'rxjs';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class CoreApiHealthIndicator {
  private readonly url: string;

  constructor(
    private readonly healthIndicatorService: HealthIndicatorService,
    private readonly http: HttpService,
    config: ConfigService<AppConfig, true>,
  ) {
    // Laravel 11+'s built-in health route (bootstrap/app.php `health: '/up'`)
    // — cheapest possible signal that core-api is reachable, not a proxy
    // for whether every domain endpoint works.
    this.url = new URL(
      '/up',
      config.get('coreApi', { infer: true }).baseUrl,
    ).toString();
  }

  async check(key: string) {
    const indicator = this.healthIndicatorService.check(key);
    try {
      await firstValueFrom(this.http.get(this.url, { timeout: 2000 }));
      return indicator.up();
    } catch (error) {
      return indicator.down({
        message: error instanceof Error ? error.message : 'unreachable',
      });
    }
  }
}
