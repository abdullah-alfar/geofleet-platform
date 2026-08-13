import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
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
  list(
    @Query() filters: ListRidesDto,
    @Req() req: Request,
  ): Promise<PaginatedResponse<RideRow>> {
    return this.rides.list(filters, req.correlationId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'A single ride request, with its milestone timeline.',
  })
  findOne(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<RideDetail> {
    return this.rides.findOne(id, req.correlationId);
  }

  @Get(':id/offers')
  @ApiOperation({
    summary: 'Every offer made for this ride request, in order.',
  })
  offers(
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<RideOfferSummary[]> {
    return this.rides.listOffers(id, req.correlationId);
  }
}
