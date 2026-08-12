import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { RidesController } from './rides.controller';
import { RidesService } from './rides.service';

@Module({
  imports: [AuthModule],
  controllers: [RidesController],
  providers: [RidesService],
})
export class RidesModule {}
