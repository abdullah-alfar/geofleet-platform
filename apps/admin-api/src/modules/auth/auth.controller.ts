import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AdminAuthService } from './admin-auth.service';
import { LoginDto } from './dto/login.dto';

/**
 * admin-api's own login — no longer a call to core-api's
 * POST /api/v1/auth/login (see docs/decisions/0011-admin-api-independent-
 * service.md). Tightly throttled, same rationale core-api's own
 * `throttle:auth` route middleware applies to its login endpoint: a
 * credential-checking endpoint is exactly the one worth protecting from
 * brute force separately from the platform's general 100/min default.
 */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Admin login — email + password, returns a session token.' })
  async login(@Body() dto: LoginDto): Promise<{ token: string }> {
    const token = await this.adminAuth.login(dto.email, dto.password);
    return { token };
  }
}
