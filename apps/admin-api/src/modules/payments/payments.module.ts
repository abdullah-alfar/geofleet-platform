import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreApiModule } from '../../integrations/core-api/core-api.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [AuthModule, CoreApiModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
})
export class PaymentsModule {}
