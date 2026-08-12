import { Module } from '@nestjs/common';
import { ProjectionsModule } from '../../projections/projections.module';
import { KafkaConsumerService } from './kafka-consumer.service';

@Module({
  imports: [ProjectionsModule],
  providers: [KafkaConsumerService],
})
export class KafkaModule {}
