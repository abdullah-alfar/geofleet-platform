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
 * No GET /drivers/:id/timeline — there's no data source for one.
 * admin_driver_projection holds current state only (last_seen_at,
 * last_location_at); no event-history table records how a driver's
 * status/location changed over time. A real timeline needs a genuinely
 * new table (an append-only driver event log), which is out of this
 * phase's scope — see docs/admin-api/query-apis.md.
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
  ): Promise<PaginatedResponse<DriverRow>> {
    return this.drivers.list(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A single driver by driver_id.' })
  findOne(@Param('id') id: string): Promise<DriverRow> {
    return this.drivers.findOne(id);
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
}
