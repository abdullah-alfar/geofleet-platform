export {};

declare global {
  namespace Express {
    interface Request {
      /** Set by CorrelationIdMiddleware before any handler/logger sees the request. */
      correlationId?: string;
    }
  }
}
