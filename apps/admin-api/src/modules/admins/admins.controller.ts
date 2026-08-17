import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CommandReasonDto } from '../../common/dto/command-reason.dto';
import type { AdminPrincipal } from '../auth/admin-principal.interface';
import { CurrentAdmin } from '../auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { AdminAccountRow, AdminsService } from './admins.service';
import { UpdateAdminRoleDto } from './dto/update-admin-role.dto';

/**
 * Managing who else can operate the admin panel is inherently a
 * highest-privilege concern — `admins.view`/`admins.manage` are not
 * listed in any non-super_admin role's ability array
 * (App\Support\AdminPermissions, core-api); only `super_admin`'s `'*'`
 * wildcard satisfies these checks in practice. Provisioning a *new*
 * admin still stays `php artisan admin:create` only (ADR 0009) — this
 * controller only manages accounts that already exist.
 */
@ApiTags('admins')
@ApiBearerAuth()
@Controller('admins')
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminsController {
  constructor(private readonly admins: AdminsService) {}

  @Get()
  @RequirePermissions('admins.view')
  @ApiOperation({ summary: 'List admin accounts.' })
  list(@Req() req: Request): Promise<AdminAccountRow[]> {
    return this.admins.list(req.correlationId);
  }

  @Patch(':id/role')
  @HttpCode(200)
  @RequirePermissions('admins.manage')
  @ApiOperation({
    summary: "Change an admin's role — direct write, see AdminsService.",
  })
  updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateAdminRoleDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() req: Request,
  ): Promise<AdminAccountRow> {
    return this.admins.updateRole(
      id,
      admin,
      dto.admin_role,
      dto.reason,
      req.correlationId,
    );
  }

  @Patch(':id/deactivate')
  @HttpCode(200)
  @RequirePermissions('admins.manage')
  @ApiOperation({
    summary: 'Deactivate an admin account — direct write, see AdminsService.',
  })
  deactivate(
    @Param('id') id: string,
    @Body() dto: CommandReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() req: Request,
  ): Promise<AdminAccountRow> {
    return this.admins.deactivate(id, admin, dto.reason, req.correlationId);
  }
}
