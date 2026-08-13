import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CommandReasonDto } from '../../common/dto/command-reason.dto';
import { CurrentAdmin } from '../auth/decorators/current-admin.decorator';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import type { AdminPrincipal } from '../auth/admin-principal.interface';
import { DriverRow, DriversService } from './drivers.service';
import { ListDriversDto } from './dto/list-drivers.dto';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';

/**
 * No GET /drivers/:id/timeline — there's no data source for one. Driver
 * rows hold current state only; no event-history table records how a
 * driver's status/location changed over time. A real timeline needs a
 * genuinely new table (an append-only driver event log), out of scope
 * here — see docs/admin-api/query-apis.md.
 */
@ApiTags('drivers')
@ApiBearerAuth()
@Controller('drivers')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions('drivers.view')
export class DriversController {
  constructor(private readonly drivers: DriversService) {}

  @Get()
  @ApiOperation({ summary: 'List drivers, filtered and cursor-paginated.' })
  list(
    @Query() filters: ListDriversDto,
    @Req() req: Request,
  ): Promise<PaginatedResponse<DriverRow>> {
    return this.drivers.list(filters, req.correlationId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A single driver by driver_id.' })
  findOne(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<DriverRow> {
    return this.drivers.findOne(id, req.correlationId);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @RequirePermissions('drivers.approve')
  @ApiOperation({
    summary:
      'Approve a driver out of pending_review — forwarded to core-api, not a local write.',
  })
  approve(
    @Param('id') id: string,
    @Body() dto: CommandReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    return this.drivers.approve(id, admin, dto.reason, req.correlationId);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @RequirePermissions('drivers.suspend')
  @ApiOperation({
    summary: 'Suspend a driver — forwarded to core-api, not a local write.',
  })
  suspend(
    @Param('id') id: string,
    @Body() dto: CommandReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    return this.drivers.suspend(id, admin, dto.reason, req.correlationId);
  }

  @Post(':id/unsuspend')
  @HttpCode(200)
  @RequirePermissions('drivers.unsuspend')
  @ApiOperation({
    summary:
      'Restore a suspended driver to active — forwarded to core-api, not a local write.',
  })
  unsuspend(
    @Param('id') id: string,
    @Body() dto: CommandReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    return this.drivers.unsuspend(id, admin, dto.reason, req.correlationId);
  }

  @Post(':id/disable')
  @HttpCode(200)
  @RequirePermissions('drivers.disable')
  @ApiOperation({
    summary:
      'Permanently disable a driver — forwarded to core-api, not a local write.',
  })
  disable(
    @Param('id') id: string,
    @Body() dto: CommandReasonDto,
    @CurrentAdmin() admin: AdminPrincipal,
    @Req() req: Request,
  ): Promise<Record<string, unknown>> {
    return this.drivers.disable(id, admin, dto.reason, req.correlationId);
  }
}
