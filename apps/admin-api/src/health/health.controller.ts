import {
  Controller,
  Get,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthCheckService,
  HealthCheck,
  HealthCheckResult,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import type { Response } from 'express';
import { PostgresHealthIndicator } from './indicators/postgres.indicator';
import { RedisHealthIndicator } from './indicators/redis.indicator';

@ApiTags('health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly redis: RedisHealthIndicator,
    private readonly postgres: PostgresHealthIndicator,
  ) {}

  /**
   * Pure liveness — never touches an external dependency. An outage in
   * Postgres/Redis must not make an orchestrator kill and restart an
   * otherwise-healthy process (same rule location-service's /healthz
   * already follows).
   */
  @Get('health')
  @ApiExcludeEndpoint()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /**
   * Terminus throws ServiceUnavailableException(result) when any indicator
   * is down, with `result` already carrying the per-dependency info/error
   * breakdown — the global exception filter's generic HttpException
   * handling would otherwise flatten that into a useless single message
   * ("Service Unavailable Exception"), throwing away exactly the detail
   * that makes /ready worth calling. Caught here so the structured body
   * survives.
   */
  @Get('ready')
  @ApiOperation({
    summary:
      'Readiness — checks every dependency this instance actually needs ' +
      '(Redis, Postgres via the broadened admin_api role). No core-api ' +
      'indicator — admin-api reads/writes Postgres directly now, with no ' +
      'runtime dependency on core-api at all (see ' +
      'docs/decisions/0011-admin-api-independent-service.md).',
  })
  @HealthCheck()
  async ready(
    @Res({ passthrough: true }) res: Response,
  ): Promise<HealthCheckResult> {
    try {
      return await this.health.check([
        (): Promise<HealthIndicatorResult> => this.redis.check('redis'),
        (): Promise<HealthIndicatorResult> => this.postgres.check('postgres'),
      ]);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        res.status(503);
        return error.getResponse() as HealthCheckResult;
      }
      throw error;
    }
  }
}
