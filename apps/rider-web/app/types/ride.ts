/** Mirrors core-api's RideRequestResource. `driver` is only non-null once
 * a driver has accepted (RideRequestController::show loads it lazily). */
export interface RideRequest {
  id: string;
  status: 'searching' | 'offered' | 'accepted' | 'cancelled' | 'expired' | 'unavailable';
  region_id: string;
  pickup: { lat: number; lng: number } | null;
  pickup_address: string | null;
  dropoff: { lat: number; lng: number } | null;
  dropoff_address: string | null;
  requested_vehicle_type: string;
  requested_at: string | null;
  accepted_at: string | null;
  cancelled_at: string | null;
  driver: RideDriver | null;
  created_at: string | null;
}

/** core-api's DriverResource — deliberately has no name/phone (Driver
 * doesn't own those columns; they live on the linked `users` row and
 * this resource doesn't join them). Rating/vehicle type is what's
 * actually available to show the rider. */
export interface RideDriver {
  id: string;
  status: string;
  is_available: boolean;
  rating: string | null;
  acceptance_rate: string | null;
  region_id: string | null;
  active_vehicle: { vehicle_type?: string; plate_number?: string } | null;
}

/** realtime-gateway's WebSocket message envelope (internal/hub.Message) —
 * one `type` discriminates the four messages a customer connection ever
 * receives (see internal/relay/handlers.go). */
export type CustomerSocketMessage =
  | { type: 'connected'; data: { customer_id: string } }
  | { type: 'ride.assigned'; data: { ride_request_id: string; driver_id: string } }
  | { type: 'ride.unavailable'; data: { ride_request_id: string } }
  | {
      type: 'driver.location';
      data: { ride_request_id: string; driver_id: string; lat: number; lng: number; recorded_at: string };
    };
