import type { AdminPrincipal } from '../../modules/auth/admin-principal.interface';

export {};

declare global {
  namespace Express {
    interface Request {
      /** Set by CorrelationIdMiddleware before any handler/logger sees the request. */
      correlationId?: string;
      /** Set by AuthGuard once the bearer token is verified. */
      admin?: AdminPrincipal;
    }
  }
}
