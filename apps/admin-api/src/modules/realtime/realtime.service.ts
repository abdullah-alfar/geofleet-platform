import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { Inject } from '@nestjs/common';
import { REDIS_CLIENT } from '../../integrations/redis/redis.module';
import { DriversService } from '../drivers/drivers.service';
import { RidesService } from '../rides/rides.service';
import { TripsService } from '../trips/trips.service';

/** An admin map isn't meant to render thousands of pins in one screen,
 * and no region in this platform is anywhere near this scale today — a
 * hard cap, not real pagination (a live-polling map can't reasonably
 * page through "the rest" the way a browsable list can). */
const MAX_MAP_DRIVERS = 500;

/** Reuses dispatch-service's own STALE_LOCATION_AGE default
 * (apps/dispatch-service/.env.example) — the same threshold dispatch-
 * service already applies when deciding whether to trust a candidate's
 * cached position during matching. A driver silent for longer than this
 * is "no longer trustworthy," by dispatch-service's own definition, not
 * a new number invented here. */
const STALE_LOCATION_AGE_MS = 60 * 1000;

/** dispatch-service's own OFFER_TTL (.env.example) is 15s per offer — a
 * ride still "searching" many multiples of one offer cycle later has
 * likely exhausted nearby candidates or is stuck, not just mid-match. */
const STALE_SEARCHING_THRESHOLD_MS = 2 * 60 * 1000;

/** Caught live: earlier load-testing phases left dozens of ride requests
 * genuinely stuck in `searching` for hours. An incident feed isn't a
 * browsable list either — same "don't return an unbounded result" rule
 * as MAX_MAP_DRIVERS, applied per incident type so one noisy type can't
 * crowd out the other. */
const MAX_INCIDENTS_PER_TYPE = 100;

/** Matches apps/dispatch-service/internal/driverindex/driverindex.go's
 * DriverState JSON shape exactly — this is dispatch-service's own
 * candidate index, read here, never written. */
interface DispatchDriverState {
  lat: number;
  lng: number;
  geohash: string;
  updated_at: string;
  available: boolean;
}

/**
 * A `dispatch:driver:{id}` key existing is not the same as it being
 * trustworthy: caught live — a driver deleted from Postgres after being
 * suspended left a key behind with `lat: 0, lng: 0` and a Go zero-time
 * `updated_at`, which would otherwise have rendered a phantom pin at 0,0
 * ("null island") until its 30-minute TTL happened to expire. Reusing
 * STALE_LOCATION_AGE_MS here — the same definition of "trustworthy"
 * dispatch-service itself applies to a candidate's cached position
 * during matching — means presence and freshness are checked together
 * everywhere this state is used, not just in the incident feed.
 */
function isFresh(state: DispatchDriverState): boolean {
  return (
    Date.now() - new Date(state.updated_at).getTime() <= STALE_LOCATION_AGE_MS
  );
}

export interface LiveDriverPosition {
  driver_id: string;
  name: string | null;
  vehicle_type: string | null;
  latitude: number;
  longitude: number;
  is_available: boolean;
  updated_at: string;
}

export interface RegionDriverMap {
  region_id: string;
  drivers: LiveDriverPosition[];
  truncated: boolean;
  sampled_at: string;
}

export interface RegionLiveCounters {
  region_id: string;
  online_drivers_live: number;
  available_drivers_live: number;
  sampled_at: string;
}

export interface StaleSearchingRideIncident {
  type: 'stale_searching_ride';
  ride_request_id: string;
  region_id: string | null;
  search_started_at: string;
  waiting_ms: number;
}

export interface SilentDriverOnTripIncident {
  type: 'silent_driver_on_trip';
  trip_id: string;
  driver_id: string;
  region_id: string | null;
  started_at: string | null;
}

export type Incident = StaleSearchingRideIncident | SilentDriverOnTripIncident;

/**
 * The only module in admin-api that reads Redis for anything other than
 * a health-check ping — see docs/admin-api/realtime-operations.md.
 * Region scoping and ride/trip incident detection call
 * DriversService/RidesService/TripsService directly now — same-process
 * method calls, not an HTTP round trip to core-api (see
 * docs/decisions/0011-admin-api-independent-service.md); only the live
 * position/availability data comes from dispatch-service's own Redis
 * index, which has no equivalent in core-api's own tables (they don't
 * track a driver's current GPS position). Deliberately does not touch
 * dispatch-service's `dispatch:geocell:*` geohash sets: region scoping
 * comes from `drivers.region_id`, then only the already-known driver ids
 * are looked up in Redis for live position. Re-implementing geohash
 * neighbor search in a second place to solve a problem dispatch-service
 * already solves for its own purpose would be pure duplication.
 */
@Injectable()
export class RealtimeService {
  constructor(
    private readonly drivers: DriversService,
    private readonly rides: RidesService,
    private readonly trips: TripsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async getRegionDriverMap(regionId: string): Promise<RegionDriverMap> {
    const response = await this.drivers.list(
      { region_id: regionId, limit: MAX_MAP_DRIVERS + 1 },
      undefined,
    );
    const rows = response.data;

    const truncated = rows.length > MAX_MAP_DRIVERS;
    const page = rows.slice(0, MAX_MAP_DRIVERS);
    const states = await this.fetchDispatchStates(
      page.map((row) => row.driver_id),
    );

    const drivers: LiveDriverPosition[] = [];
    for (const row of page) {
      const state = states.get(row.driver_id);
      if (!state || !isFresh(state)) continue;
      drivers.push({
        driver_id: row.driver_id,
        name: row.name,
        vehicle_type: row.vehicle_type,
        latitude: state.lat,
        longitude: state.lng,
        is_available: state.available,
        updated_at: state.updated_at,
      });
    }

    return {
      region_id: regionId,
      drivers,
      truncated,
      sampled_at: new Date().toISOString(),
    };
  }

  async getRegionLiveCounters(regionId: string): Promise<RegionLiveCounters> {
    const response = await this.drivers.list(
      { region_id: regionId, limit: MAX_MAP_DRIVERS },
      undefined,
    );

    const states = await this.fetchDispatchStates(
      response.data.map((row) => row.driver_id),
    );

    let onlineCount = 0;
    let availableCount = 0;
    for (const state of states.values()) {
      if (!isFresh(state)) continue;
      onlineCount += 1;
      if (state.available) availableCount += 1;
    }

    return {
      region_id: regionId,
      online_drivers_live: onlineCount,
      available_drivers_live: availableCount,
      sampled_at: new Date().toISOString(),
    };
  }

  async getIncidents(): Promise<Incident[]> {
    const [staleSearching, silentDrivers] = await Promise.all([
      this.staleSearchingRides(),
      this.silentDriversOnActiveTrips(),
    ]);
    return [...staleSearching, ...silentDrivers];
  }

  /** One pipelined MGET, not N round trips. */
  private async fetchDispatchStates(
    driverIds: string[],
  ): Promise<Map<string, DispatchDriverState>> {
    const result = new Map<string, DispatchDriverState>();
    if (driverIds.length === 0) {
      return result;
    }

    const keys = driverIds.map((id) => `dispatch:driver:${id}`);
    const values = await this.redis.mget(keys);

    values.forEach((raw, index) => {
      if (!raw) return;
      try {
        result.set(driverIds[index], JSON.parse(raw) as DispatchDriverState);
      } catch {
        // Malformed value under a key only dispatch-service ever writes —
        // skip rather than fail the whole request for one bad pin.
      }
    });

    return result;
  }

  private async staleSearchingRides(): Promise<StaleSearchingRideIncident[]> {
    const threshold = new Date(
      Date.now() - STALE_SEARCHING_THRESHOLD_MS,
    ).toISOString();

    // Caught live: earlier load-testing phases left dozens of ride
    // requests genuinely stuck in `searching` for hours (no driver ever
    // available at the time, and nothing ever swept them to
    // `unavailable`) — an unbounded query here would return all of them.
    // `order=oldest` + a hard cap: the cap keeps the worst offenders,
    // not an arbitrary slice.
    const response = await this.rides.list(
      {
        status: 'searching',
        date_to: threshold,
        order: 'oldest',
        limit: MAX_INCIDENTS_PER_TYPE,
      },
      undefined,
    );

    return response.data
      .filter(
        (row): row is typeof row & { requested_at: string } =>
          row.requested_at !== null,
      )
      .map((row) => ({
        type: 'stale_searching_ride' as const,
        ride_request_id: row.ride_request_id,
        region_id: row.region_id,
        search_started_at: row.requested_at,
        waiting_ms: Date.now() - new Date(row.requested_at).getTime(),
      }));
  }

  private async silentDriversOnActiveTrips(): Promise<
    SilentDriverOnTripIncident[]
  > {
    const response = await this.trips.list(
      {
        status: 'in_progress',
        order: 'oldest',
        limit: MAX_INCIDENTS_PER_TYPE,
      },
      undefined,
    );

    const rows = response.data.filter(
      (row): row is typeof row & { driver_id: string } =>
        row.driver_id !== null,
    );
    if (rows.length === 0) {
      return [];
    }

    const states = await this.fetchDispatchStates(
      rows.map((row) => row.driver_id),
    );
    const incidents: SilentDriverOnTripIncident[] = [];

    for (const row of rows) {
      const state = states.get(row.driver_id);
      const isSilent = !state || !isFresh(state);

      if (isSilent) {
        incidents.push({
          type: 'silent_driver_on_trip',
          trip_id: row.trip_id,
          driver_id: row.driver_id,
          region_id: row.region_id,
          started_at: row.started_at,
        });
      }
    }

    return incidents;
  }
}
