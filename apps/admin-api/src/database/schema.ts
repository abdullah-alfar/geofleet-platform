import { ColumnType, Generated } from 'kysely';

/**
 * Typed shape of the `admin_read` schema (owned by the `admin_api`
 * Postgres role — docs/decisions/0009-admin-identity.md). Every table
 * here is a Kafka-derived read model: rebuildable from the event stream,
 * never a source of truth, never written to except by the Phase 4
 * projection consumers (once they exist) and this phase's migrations.
 * See docs/admin-api/read-models.md for the full design and which
 * topics feed which table.
 *
 * NUMERIC/DECIMAL columns (`rating`, `estimated_price`, `final_price`,
 * `amount`) are typed as `string`, not `number` — node-postgres decodes
 * Postgres NUMERIC as a JS string by default specifically to avoid
 * floating-point precision loss on money-shaped values. Typing them as
 * `number` here would silently lie about what a query actually returns.
 */

export interface AdminConsumerInboxTable {
  id: Generated<number>;
  consumer_name: string;
  event_id: string;
  event_type: string;
  processed_at: ColumnType<Date, Date | string, never>;
  created_at: Generated<ColumnType<Date, Date | string | undefined, never>>;
}

export interface AdminDriverProjectionTable {
  driver_id: string;
  name: string;
  phone_masked: string | null;
  status: string;
  availability_status: string | null;
  vehicle_type: string | null;
  rating: string | null;
  region_id: string | null;
  last_location_at: ColumnType<
    Date,
    Date | string | null,
    Date | string | null
  > | null;
  last_seen_at: ColumnType<
    Date,
    Date | string | null,
    Date | string | null
  > | null;
  active_trip_id: string | null;
  updated_at: Generated<
    ColumnType<Date, Date | string | undefined, Date | string>
  >;
}

export interface AdminRideProjectionTable {
  ride_request_id: string;
  customer_id: string;
  driver_id: string | null;
  region_id: string | null;
  status: string;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  dropoff_latitude: number | null;
  dropoff_longitude: number | null;
  requested_at: ColumnType<Date, Date | string | null, never> | null;
  search_started_at: ColumnType<
    Date,
    Date | string | null,
    Date | string | null
  > | null;
  assigned_at: ColumnType<
    Date,
    Date | string | null,
    Date | string | null
  > | null;
  unavailable_at: ColumnType<
    Date,
    Date | string | null,
    Date | string | null
  > | null;
  cancelled_at: ColumnType<
    Date,
    Date | string | null,
    Date | string | null
  > | null;
  updated_at: Generated<
    ColumnType<Date, Date | string | undefined, Date | string>
  >;
}

/** One row per driver offered a given ride — powers GET /rides/{id}/offers. */
export interface AdminRideOfferProjectionTable {
  offer_id: string;
  ride_request_id: string;
  driver_id: string;
  status: string;
  created_at: ColumnType<Date, Date | string | null, never> | null;
  expires_at: ColumnType<
    Date,
    Date | string | null,
    Date | string | null
  > | null;
  responded_at: ColumnType<
    Date,
    Date | string | null,
    Date | string | null
  > | null;
  updated_at: Generated<
    ColumnType<Date, Date | string | undefined, Date | string>
  >;
}

export interface AdminTripProjectionTable {
  trip_id: string;
  customer_id: string;
  driver_id: string;
  region_id: string | null;
  status: string;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  dropoff_latitude: number | null;
  dropoff_longitude: number | null;
  requested_at: ColumnType<Date, Date | string | null, never> | null;
  accepted_at: ColumnType<
    Date,
    Date | string | null,
    Date | string | null
  > | null;
  started_at: ColumnType<
    Date,
    Date | string | null,
    Date | string | null
  > | null;
  completed_at: ColumnType<
    Date,
    Date | string | null,
    Date | string | null
  > | null;
  cancelled_at: ColumnType<
    Date,
    Date | string | null,
    Date | string | null
  > | null;
  estimated_price: string | null;
  final_price: string | null;
  updated_at: Generated<
    ColumnType<Date, Date | string | undefined, Date | string>
  >;
}

/**
 * `payment.*.v1` topics are all "planned" in
 * docs/events/topic-catalog.md — no producer exists in core-api yet. This
 * table is built now (Phase 3 scope) but will stay empty until that
 * changes, the same honest gap docs/architecture/data-flow.md already
 * documents for `trip.location.updated.v1`.
 */
export interface AdminPaymentProjectionTable {
  payment_id: string;
  trip_id: string | null;
  customer_id: string | null;
  status: string;
  provider: string | null;
  amount: string | null;
  currency: string | null;
  region_id: string | null;
  created_at: ColumnType<Date, Date | string | null, never> | null;
  paid_at: ColumnType<Date, Date | string | null, Date | string | null> | null;
  updated_at: Generated<
    ColumnType<Date, Date | string | undefined, Date | string>
  >;
}

export interface AdminRegionMetricsTable {
  region_id: string;
  online_drivers: Generated<number>;
  available_drivers: Generated<number>;
  active_trips: Generated<number>;
  searching_rides: Generated<number>;
  rides_today: Generated<number>;
  completed_today: Generated<number>;
  cancelled_today: Generated<number>;
  failed_payments_today: Generated<number>;
  average_match_time_ms: number | null;
  updated_at: Generated<
    ColumnType<Date, Date | string | undefined, Date | string>
  >;
}

export interface Database {
  admin_consumer_inbox: AdminConsumerInboxTable;
  admin_driver_projection: AdminDriverProjectionTable;
  admin_ride_projection: AdminRideProjectionTable;
  admin_ride_offer_projection: AdminRideOfferProjectionTable;
  admin_trip_projection: AdminTripProjectionTable;
  admin_payment_projection: AdminPaymentProjectionTable;
  admin_region_metrics: AdminRegionMetricsTable;
}
