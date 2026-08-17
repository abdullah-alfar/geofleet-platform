import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DriversController } from './drivers.controller';
import { DriversService } from './drivers.service';

@Module({
  imports: [AuthModule],
  controllers: [DriversController],
  providers: [DriversService],
  // Exported so RealtimeModule can inject it directly for the live
  // driver-map lookup — a same-process call now, not an HTTP round trip
  // (see docs/decisions/0011-admin-api-independent-service.md).
  exports: [DriversService],
})
export class DriversModule {}
