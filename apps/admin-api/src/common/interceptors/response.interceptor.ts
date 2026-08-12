import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Wraps every successful JSON response in `{ data: ... }`, per this
 * platform's admin-api response standard. Passes through unchanged when
 * the handler already returned a `{ data, meta }` shape itself (list
 * endpoints building cursor pagination, Phase 5) to avoid double-wrapping,
 * and when the payload is a string/Buffer (the Prometheus /metrics text
 * exposition format must never be JSON-wrapped).
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((payload) => {
        if (typeof payload === 'string' || Buffer.isBuffer(payload)) {
          return payload;
        }

        if (
          payload &&
          typeof payload === 'object' &&
          'data' in (payload as Record<string, unknown>)
        ) {
          return payload;
        }

        return { data: payload };
      }),
    );
  }
}
