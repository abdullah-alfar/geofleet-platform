import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { contentType } from 'prom-client';
import { MetricsService } from './metrics.service';

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Get('metrics')
  @ApiExcludeEndpoint()
  @Header('Content-Type', contentType)
  async scrape(): Promise<string> {
    return this.metrics.registry.metrics();
  }
}
