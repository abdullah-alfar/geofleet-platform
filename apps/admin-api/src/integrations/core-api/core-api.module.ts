import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { CoreApiClientService } from './core-api-client.service';

@Module({
  imports: [HttpModule],
  providers: [CoreApiClientService],
  exports: [CoreApiClientService],
})
export class CoreApiModule {}
