import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PERMISSIONS_KEY } from '../decorators/require-permissions.decorator';

/**
 * Must run after AuthGuard (request.admin must already be populated) —
 * enforced at runtime by throwing rather than silently allowing, since
 * a misordered guard stack is a programming error, not a client 401/403.
 * A route with no @RequirePermissions() metadata is allowed for any
 * authenticated admin (same as @CurrentAdmin() usage elsewhere) — the
 * decorator is opt-in per route, not a default-deny without it.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    if (!request.admin) {
      throw new InternalServerErrorException(
        'PermissionsGuard used on a route without AuthGuard.',
      );
    }

    const { abilities } = request.admin;
    if (abilities.includes('*')) {
      return true;
    }

    const missing = required.filter((p) => !abilities.includes(p));
    if (missing.length > 0) {
      throw new ForbiddenException(
        `Missing required permission(s): ${missing.join(', ')}.`,
      );
    }

    return true;
  }
}
