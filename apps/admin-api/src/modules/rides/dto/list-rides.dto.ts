import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

export class ListRidesDto extends PaginationQueryDto {
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
  customer_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  driver_id?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 — requested at or after this time.',
  })
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 — requested at or before this time.',
  })
  @IsOptional()
  @IsDateString()
  date_to?: string;

  @ApiPropertyOptional({
    description:
      "'oldest' powers the incident feed's stuck-searching-ride lookup — a one-shot capped fetch, not real pagination (never sent alongside a cursor).",
    enum: ['recent', 'oldest'],
  })
  @IsOptional()
  @IsIn(['recent', 'oldest'])
  order?: 'recent' | 'oldest';
}
