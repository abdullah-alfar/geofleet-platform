import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [AuthModule],
  controllers: [TripsController],
  providers: [TripsService],
  // Exported so RealtimeModule can inject it directly for the silent-
  // driver-on-trip incident lookup — a same-process call now, not an
  // HTTP round trip (see docs/decisions/0011-admin-api-independent-
  // service.md).
  exports: [TripsService],
})
export class TripsModule {}
