import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

export class ListCustomersDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  region_id?: string;

  @ApiPropertyOptional({
    description: "Matches against the customer's name (prefix, case-insensitive).",
  })
  @IsOptional()
  @IsString()
  search?: string;
}
