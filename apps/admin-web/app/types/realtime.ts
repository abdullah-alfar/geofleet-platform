/** Mirrors admin-api's RealtimeService types (Phase 7 — the only Redis-
 * backed reads in the platform, beyond a health ping). */
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

export interface DriverTrace {
  driver_id: string;
  name: string | null;
  vehicle_type: string | null;
  status: string | null;
  online: boolean;
  latitude: number | null;
  longitude: number | null;
  is_available: boolean | null;
  updated_at: string | null;
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
