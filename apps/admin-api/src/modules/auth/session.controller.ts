import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AdminPrincipal } from './admin-principal.interface';
import { CurrentAdmin } from './decorators/current-admin.decorator';
import { AuthGuard } from './guards/auth.guard';

/**
 * "Who am I" — proves the whole auth chain (header parsing, Sanctum-
 * compatible token verification against Postgres, principal resolution)
 * against real infrastructure. Deliberately no @RequirePermissions(): any
 * authenticated admin can see their own session, the same way core-api's
 * own GET /api/v1/auth/me needs no role-specific permission beyond being
 * logged in.
 */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('session')
@UseGuards(AuthGuard)
export class SessionController {
  @Get()
  @ApiOperation({
    summary: "The authenticated admin's own identity and permissions.",
  })
  whoami(@CurrentAdmin() admin: AdminPrincipal): AdminPrincipal {
    return admin;
  }
}
