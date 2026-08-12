import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const start = process.hrtime.bigint();

    const record = (): void => {
      // req.route is only populated once Express has matched a route —
      // true by the time this interceptor's tap/finalize runs — so labels
      // stay low-cardinality (route pattern, not raw URL with ids in it).
      // @types/express types `route` as `any`, hence the explicit guard.
      const routePath: unknown = (request as { route?: { path?: unknown } })
        .route?.path;
      const route =
        typeof routePath === 'string' ? routePath : (request.path ?? 'unknown');
      const labels = {
        method: request.method,
        route,
        status: String(response.statusCode),
      };
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.httpRequestsTotal.inc(labels);
      this.metrics.httpRequestDuration.observe(labels, durationSeconds);
    };

    return next.handle().pipe(tap({ next: record, error: record }));
  }
}
