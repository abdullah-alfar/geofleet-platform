import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreApiModule } from '../../integrations/core-api/core-api.module';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [AuthModule, CoreApiModule],
  controllers: [TripsController],
  providers: [TripsService],
})
export class TripsModule {}
