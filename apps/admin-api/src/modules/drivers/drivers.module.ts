import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreApiModule } from '../../integrations/core-api/core-api.module';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

@Module({
  imports: [AuthModule, CoreApiModule],
  controllers: [DriversController],
  providers: [DriversService],
})
export class DriversModule {}
