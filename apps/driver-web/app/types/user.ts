/** core-api's VehicleResource, embedded in DriverResource as `active_vehicle`. */
export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  color: string;
  plate_number: string;
  vehicle_type: 'sedan' | 'suv' | 'van' | 'motorcycle';
  status: string;
  is_active: boolean;
  created_at: string | null;
}

/** core-api's DriverResource (App\Http\Resources\DriverResource) — no
 * name/phone (those live on the linked `users` row, not joined here). */
export interface DriverProfile {
  id: string;
  status: 'pending_review' | 'active' | 'suspended' | 'disabled';
  is_available: boolean;
  rating: string | null;
  acceptance_rate: string | null;
  region_id: string | null;
  license_expires_at: string | null;
  active_vehicle: Vehicle | null;
  created_at: string | null;
}

/** Mirrors core-api's UserResource — this app only ever registers/logs in
 * as role 'driver'. */
export interface DriverAccountUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  region_id: string | null;
  driver: DriverProfile | null;
  created_at: string | null;
}
