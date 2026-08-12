import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Shared body shape for every command endpoint (suspend/cancel/refund). */
export class CommandReasonDto {
  @ApiPropertyOptional({
    description: 'Free-text reason, recorded in core-api audit_logs.',
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
