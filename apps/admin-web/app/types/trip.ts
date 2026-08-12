/** Mirrors admin-api's TripRow/TripDetail (trips.service.ts). */
export interface Trip {
  trip_id: string;
  customer_id: string;
  driver_id: string;
  region_id: string | null;
  status: string;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  dropoff_latitude: number | null;
  dropoff_longitude: number | null;
  requested_at: string | null;
  accepted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  estimated_price: string | null;
  final_price: string | null;
  updated_at: string;
}

export interface TripMilestone {
  event: string;
  at: string;
}

export interface TripDetail extends Trip {
  timeline: TripMilestone[];
}
