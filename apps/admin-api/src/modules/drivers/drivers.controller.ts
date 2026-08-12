import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
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
}
