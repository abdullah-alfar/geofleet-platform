import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import {
  DriverTrace,
  Incident,
  RealtimeService,
  RegionDriverMap,
  RegionLiveCounters,
} from './realtime.service';

/**
 * The only endpoints in admin-api backed by Redis reads rather than
 * Postgres — see docs/admin-api/realtime-operations.md for why each one
 * exists and what "live" means for it (bounded by dispatch-service's own
 * write cadence, not sub-second in an absolute sense). Throttled tighter
 * than the platform's 100/min default (app.module.ts) since these are
 * meant to be polled frequently by a live dashboard widget, not browsed —
 * a tight per-route limit protects Redis from an accidental tight poll
 * loop without blocking the intended usage pattern.
 */
@ApiTags('realtime')
@ApiBearerAuth()
@Controller('realtime')
@UseGuards(AuthGuard, PermissionsGuard)
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Get('regions/:regionId/drivers')
  @RequirePermissions('drivers.view')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Live driver positions in a region, from dispatch-service’s own Redis index.',
  })
  regionDrivers(@Param('regionId') regionId: string): Promise<RegionDriverMap> {
    return this.realtime.getRegionDriverMap(regionId);
  }

  @Get('drivers/:driverId')
  @RequirePermissions('drivers.view')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Live position for a single driver, from dispatch-service’s own Redis index — meant to be polled every couple of seconds by a focused tracking view, not the full region map.',
  })
  driverPosition(@Param('driverId') driverId: string): Promise<DriverTrace> {
    return this.realtime.getDriverPosition(driverId);
  }

  @Get('regions/:regionId/counters')
  @RequirePermissions('dashboard.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Live online/available driver counts for a region, sampled from Redis right now.',
  })
  regionCounters(
    @Param('regionId') regionId: string,
  ): Promise<RegionLiveCounters> {
    return this.realtime.getRegionLiveCounters(regionId);
  }

  @Get('incidents')
  @RequirePermissions('dashboard.view')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Computed operational anomalies: stuck ride matching, drivers gone silent mid-trip.',
  })
  incidents(): Promise<Incident[]> {
    return this.realtime.getIncidents();
  }
}
