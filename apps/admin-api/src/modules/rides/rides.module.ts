import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreApiModule } from '../../integrations/core-api/core-api.module';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  imports: [AuthModule, CoreApiModule],
  controllers: [RidesController],
  providers: [RidesService],
})
export class RidesModule {}
