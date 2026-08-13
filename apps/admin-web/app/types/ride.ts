/** Mirrors admin-api's RideRow/RideDetail/RideOfferSummary (rides.service.ts). */
export interface Ride {
  ride_request_id: string;
  customer_id: string | null;
  driver_id: string | null;
  region_id: string | null;
  status: string;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  dropoff_latitude: number | null;
  dropoff_longitude: number | null;
  requested_at: string | null;
  accepted_at: string | null;
  cancelled_at: string | null;
  updated_at: string;
}

export interface RideMilestone {
  event: string;
  at: string;
}

export interface RideDetail extends Ride {
  timeline: RideMilestone[];
}

export interface RideOffer {
  offer_id: string;
  ride_request_id: string;
  driver_id: string;
  status: string;
  created_at: string | null;
  expires_at: string | null;
  responded_at: string | null;
  updated_at: string;
  is_expired: boolean;
}
