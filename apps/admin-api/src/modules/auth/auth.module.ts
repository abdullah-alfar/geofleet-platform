import { Module } from '@nestjs/common';
import { AuthGuard } from './guards/auth.guard';
import { PermissionsGuard } from './guards/permissions.guard';
import { SessionController } from './session.controller';
import { TokenVerificationService } from './token-verification.service';

@Module({
  controllers: [SessionController],
  providers: [TokenVerificationService, AuthGuard, PermissionsGuard],
  exports: [TokenVerificationService, AuthGuard, PermissionsGuard],
})
export class AuthModule {}
