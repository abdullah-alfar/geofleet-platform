import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CoreApiModule } from '../../integrations/core-api/core-api.module';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';

@Module({
  imports: [AuthModule, CoreApiModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
