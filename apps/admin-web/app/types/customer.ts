/** Mirrors admin-api's CustomerRow (customers.service.ts). */
export interface Customer {
  customer_id: string;
  name: string | null;
  email: string | null;
  phone_masked: string | null;
  status: string | null;
  region_id: string | null;
  rating: string | null;
  total_rides: number | null;
  total_trips: number | null;
  created_at: string | null;
  updated_at: string | null;
}
