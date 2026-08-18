/** Mirrors core-api's UserResource — this app only ever registers/logs in
 * as role 'customer', so `customer` is always populated once loaded. */
export interface RiderUser {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  region_id: string | null;
  customer: { id: string; rating: string | null; created_at: string | null } | null;
  created_at: string | null;
}
