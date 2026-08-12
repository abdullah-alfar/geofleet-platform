import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminPrincipal } from '../admin-principal.interface';

/**
 * Only valid on a route guarded by AuthGuard — throws rather than silently
 * returning undefined if used without it, since that would be a
 * programming error (a handler assuming it received an admin identity that
 * was never verified), not a client-facing 401/403.
 */
export const CurrentAdmin = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AdminPrincipal => {
    const request = ctx.switchToHttp().getRequest<Request>();
    if (!request.admin) {
      throw new InternalServerErrorException(
        '@CurrentAdmin() used on a route without AuthGuard.',
      );
    }
    return request.admin;
  },
);
