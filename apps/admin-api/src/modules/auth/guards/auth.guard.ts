import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TokenVerificationService } from '../token-verification.service';

const BEARER_PREFIX = 'Bearer ';

/**
 * Verifies the Authorization header as an admin Sanctum token and attaches
 * the resolved AdminPrincipal to the request. Every failure mode (missing
 * header, malformed token, unknown token, expired, wrong role, suspended
 * account) collapses to the same 401 — an admin BFF's auth guard should
 * never tell a caller *why* a credential didn't work (account enumeration
 * risk), same principle as core-api's own login error handling.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly tokens: TokenVerificationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('Authorization');

    if (!header || !header.startsWith(BEARER_PREFIX)) {
      throw new UnauthorizedException('Authentication required.');
    }

    const rawToken = header.slice(BEARER_PREFIX.length).trim();
    const principal = await this.tokens.verify(rawToken);

    if (!principal) {
      throw new UnauthorizedException('Invalid or expired credentials.');
    }

    request.admin = principal;
    return true;
  }
}
