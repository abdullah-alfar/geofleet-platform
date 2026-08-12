import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { CORRELATION_ID_HEADER, UUID_REGEX } from '../constants';

/**
 * Reuses a client-supplied X-Correlation-Id (same convention as core-api's
 * AssignCorrelationId and location-service's correlationMiddleware) or
 * generates one. Applied via app.use() in main.ts, before Swagger/helmet/
 * logging, so req.correlationId exists for every subsequent handler,
 * pino's genReqId, and the global exception filter.
 */
export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const supplied = req.header(CORRELATION_ID_HEADER);
  req.correlationId =
    supplied && UUID_REGEX.test(supplied) ? supplied : randomUUID();
  res.setHeader(CORRELATION_ID_HEADER, req.correlationId);
  next();
}
