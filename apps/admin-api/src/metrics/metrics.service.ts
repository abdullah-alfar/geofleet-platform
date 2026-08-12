import { Injectable, OnModuleDestroy } from '@nestjs/common';
import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';

/**
 * Own registry, not prom-client's process-wide default — same convention
 * every Go service in this platform already follows (see e.g.
 * apps/location-service/internal/metrics), so scraping this service never
 * accidentally picks up metrics some other library registered globally.
 */
@Injectable()
export class MetricsService implements OnModuleDestroy {
  readonly registry = new Registry();

  readonly httpRequestsTotal = new Counter({
    name: 'admin_api_http_requests_total',
    help: 'Total HTTP requests handled, by method/route/status.',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [this.registry],
  });

  readonly httpRequestDuration = new Histogram({
    name: 'admin_api_http_request_duration_seconds',
    help: 'HTTP request duration in seconds, by method/route/status.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'admin_api_' });
  }

  onModuleDestroy(): void {
    this.registry.clear();
  }
}
