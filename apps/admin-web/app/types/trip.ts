/** Mirrors admin-api's TripRow/TripDetail (trips.service.ts). */
export interface Trip {
  trip_id: string;
  customer_id: string | null;
  driver_id: string | null;
  region_id: string | null;
  status: string;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  dropoff_latitude: number | null;
  dropoff_longitude: number | null;
  distance_meters: string | null;
  duration_seconds: number | null;
  fare_amount: string | null;
  currency: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
}

export interface TripMilestone {
  event: string;
  at: string;
}

export interface TripDetail extends Trip {
  timeline: TripMilestone[];
}
