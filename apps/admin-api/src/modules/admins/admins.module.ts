import { Module } from '@nestjs/common';
import { CoreApiModule } from '../../integrations/core-api/core-api.module';
import { AuthModule } from '../auth/auth.module';
import { AdminsController } from './admins.controller';
import { AdminsService } from './admins.service';

@Module({
  imports: [AuthModule, CoreApiModule],
  controllers: [AdminsController],
  providers: [AdminsService],
})
export class AdminsModule {}
