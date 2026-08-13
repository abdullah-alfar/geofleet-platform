import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  DashboardService,
  DashboardSummary,
  RegionMetrics,
} from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
@UseGuards(AuthGuard, PermissionsGuard)
@RequirePermissions('dashboard.view')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('summary')
  @ApiOperation({ summary: "Platform-wide live counts and today's totals." })
  summary(@Req() req: Request): Promise<DashboardSummary> {
    return this.dashboard.getSummary(req.correlationId);
  }

  @Get('regions')
  @ApiOperation({ summary: 'Live counts broken down by region_id.' })
  regions(@Req() req: Request): Promise<RegionMetrics[]> {
    return this.dashboard.getRegions(req.correlationId);
  }
}
