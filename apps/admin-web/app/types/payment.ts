/** Mirrors admin-api's PaymentRow (payments.service.ts). */
export interface Payment {
  payment_id: string;
  trip_id: string | null;
  customer_id: string | null;
  status: string;
  provider: string | null;
  amount: string | null;
  currency: string | null;
  region_id: string | null;
  created_at: string | null;
  paid_at: string | null;
  updated_at: string;
}
