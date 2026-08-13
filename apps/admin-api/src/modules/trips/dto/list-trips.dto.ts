import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

export class ListTripsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  region_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driver_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  customer_id?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 — against trips.started_at, at or after this time.',
  })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 — against trips.started_at, at or before this time.',
  })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({
    description: 'Against trips.fare_amount (null until the trip completes).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minimum_price?: number;

  @ApiPropertyOptional({
    description: 'Against trips.fare_amount (null until the trip completes).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maximum_price?: number;
}
