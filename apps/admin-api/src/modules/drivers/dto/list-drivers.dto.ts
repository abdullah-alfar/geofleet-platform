import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

export class ListDriversDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  availability_status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vehicle_type?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  region_id?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 — drivers last seen at or after this time.',
  })
  @IsOptional()
  @IsDateString()
  last_seen_from?: string;

  @ApiPropertyOptional({
    description: 'ISO 8601 — drivers last seen at or before this time.',
  })
  @IsOptional()
  @IsDateString()
  last_seen_to?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  rating_from?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(5)
  rating_to?: number;

  @ApiPropertyOptional({
    description:
      'Matches against driver_id (prefix). No name-based search is possible yet — ' +
      'driver.status.changed.v1 carries no name, see docs/admin-api/kafka-projections.md.',
  })
  @IsOptional()
  @IsString()
  search?: string;
}
