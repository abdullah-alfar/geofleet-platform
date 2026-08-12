import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PaginatedResponse } from '../../common/pagination/paginated-response.interface';
import { ListRidesDto } from './dto/list-rides.dto';
import {
  RideDetail,
  RideOfferSummary,
  RideRow,
  RidesService,
} from './rides.service';

@ApiTags('rides')
@ApiBearerAuth()
@Controller('rides')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions('rides.view')
export class RidesController {
  constructor(private readonly rides: RidesService) {}

  @Get()
  @ApiOperation({
    summary: 'List ride requests, filtered and cursor-paginated.',
  })
  list(@Query() filters: ListRidesDto): Promise<PaginatedResponse<RideRow>> {
    return this.rides.list(filters);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'A single ride request, with its milestone timeline.',
  })
  findOne(@Param('id') id: string): Promise<RideDetail> {
    return this.rides.findOne(id);
  }

  @Get(':id/offers')
  @ApiOperation({
    summary: 'Every offer made for this ride request, in order.',
  })
  offers(@Param('id') id: string): Promise<RideOfferSummary[]> {
    return this.rides.listOffers(id);
  }
}
