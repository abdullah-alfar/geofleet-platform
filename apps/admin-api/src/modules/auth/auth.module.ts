import { Module } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './guards/auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { SessionController } from './session.controller';
import { TokenVerificationService } from './token-verification.service';

@Module({
  controllers: [AuthController, SessionController],
  providers: [
    AdminAuthService,
    TokenVerificationService,
    AuthGuard,
    PermissionsGuard,
  ],
  exports: [TokenVerificationService, AuthGuard, PermissionsGuard],
})
export class AuthModule {}
