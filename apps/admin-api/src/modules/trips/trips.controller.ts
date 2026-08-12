import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { ListTripsDto } from './dto/list-trips.dto';
import { TripDetail, TripRow, TripsService } from './trips.service';

/**
 * No GET /trips/:id/timeline as a separate endpoint — its milestones are
 * embedded directly in GET /trips/:id's `timeline` field instead, built
 * from this table's own requested_at/accepted_at/started_at/
 * completed_at/cancelled_at columns (real data, not derived/invented).
 */
@ApiTags('trips')
@ApiBearerAuth()
@Controller('trips')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions('trips.view')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  @ApiOperation({ summary: 'List trips, filtered and cursor-paginated.' })
  list(@Query() filters: ListTripsDto): Promise<PaginatedResponse<TripRow>> {
    return this.trips.list(filters);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A single trip, with its milestone timeline.' })
  findOne(@Param('id') id: string): Promise<TripDetail> {
    return this.trips.findOne(id);
  }
}
