import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/** Mirrors App\Support\AdminPermissions::validRoles() (core-api) — core-api
 * re-validates this independently (its own source of truth), this is a
 * fast client-side rejection so a typo doesn't round-trip needlessly. */
export const ADMIN_ROLES = [
  'super_admin',
  'operations_admin',
  'support_admin',
  'finance_admin',
  'viewer',
] as const;

export class UpdateAdminRoleDto {
  @ApiProperty({ enum: ADMIN_ROLES })
  @IsIn(ADMIN_ROLES)
  admin_role!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
