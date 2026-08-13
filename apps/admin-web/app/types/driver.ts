/** Mirrors admin-api's DriverRow (drivers.service.ts) exactly. */
export interface Driver {
  driver_id: string;
  name: string | null;
  phone_masked: string | null;
  status: string | null;
  availability_status: string | null;
  vehicle_type: string | null;
  rating: string | null;
  region_id: string | null;
  active_trip_id: string | null;
  last_available_at: string | null;
  updated_at: string;
}
