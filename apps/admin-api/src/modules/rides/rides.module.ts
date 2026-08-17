import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  imports: [AuthModule],
  controllers: [RidesController],
  providers: [RidesService],
  // Exported so RealtimeModule can inject it directly for the stale-
  // searching-ride incident lookup — a same-process call now, not an
  // HTTP round trip (see docs/decisions/0011-admin-api-independent-
  // service.md).
  exports: [RidesService],
})
export class RidesModule {}
