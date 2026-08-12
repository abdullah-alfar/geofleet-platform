import { ColumnType, Generated } from 'kysely';

/**
 * Typed shape of the `admin_read` schema (owned by the `admin_api`
 * Postgres role — docs/decisions/0009-admin-identity.md). Every table
 * here is a Kafka-derived read model: rebuildable from the event stream,
 * never a source of truth, never written to except by the Phase 4
 * projection consumers and this phase's migrations. See
 * docs/admin-api/read-models.md for the full design and which topics
 * feed which table.
 *
 * NUMERIC/DECIMAL columns (`rating`, `estimated_price`, `final_price`,
 * `amount`) are typed as `string`, not `number` — node-postgres decodes
 * Postgres NUMERIC as a JS string by default specifically to avoid
 * floating-point precision loss on money-shaped values. Typing them as
 * `number` here would silently lie about what a query actually returns.
 *
 * Timestamp columns: a plain `Date | null` (or `Date`) field is used
 * wherever select/insert/update types genuinely coincide — every
 * projection handler always constructs a real `Date` before writing, so
 * there's no need to additionally accept raw strings at the type level.
 * `Kysely.Generated<S>` (NOT `Generated<ColumnType<...>>` — Generated
 * already expects a plain type, not a ColumnType; nesting them wraps a
 * ColumnType around a ColumnType and produces nonsensical insert/update
 * types) is used only for `updated_at`, where the DB default makes it
 * optional on insert. `ColumnType` itself is reserved for the few columns
 * whose update type is genuinely `never` (set once at insert, never
 * touched again).
 */

export interface AdminConsumerInboxTable {
  id: Generated<number>;
  consumer_name: string;
  event_id: string;
  event_type: string;
  processed_at: Date;
  created_at: Generated<Date>;
}

export interface AdminDriverProjectionTable {
  driver_id: string;
  // Nullable, not string — no live event carries a driver's name or
  // approval status (see 20260814100000_relax_projection_required_columns.ts).
  name: string | null;
  phone_masked: string | null;
  status: string | null;
  availability_status: string | null;
  vehicle_type: string | null;
  rating: string | null;
  region_id: string | null;
  last_location_at: Date | null;
  last_seen_at: Date | null;
  active_trip_id: string | null;
  updated_at: Generated<Date>;
}

export interface AdminRideProjectionTable {
  ride_request_id: string;
  // Nullable — ride.search.started/assigned/unavailable.v1 are separate
  // Kafka topics from ride.requested.v1 (the only event carrying
  // customer_id); per-key ordering is per-topic-partition, not guaranteed
  // across topics (see 20260814100000_relax_projection_required_columns.ts).
  customer_id: string | null;
  driver_id: string | null;
  region_id: string | null;
  status: string;
  pickup_latitude: number | null;
  pickup_longitude: number | null;
  dropoff_latitude: number | null;
  dropoff_longitude: number | null;
  /** Set once, at insert (ride.requested.v1) — never updated afterward. */
  requested_at: ColumnType<Date | null, Date | null | undefined, never>;
  search_started_at: Date | null;
  assigned_at: Date | null;
  unavailable_at: Date | null;
  cancelled_at: Date | null;
  updated_at: Generated<Date>;
}

/** One row per driver offered a given ride — powers GET /rides/{id}/offers. */
export interface AdminRideOfferProjectionTable {
  offer_id: string;
  ride_request_id: string;
  driver_id: string;
  status: string;
  /** Set once, at insert (ride.offer.created.v1) — never updated afterward. */
  created_at: ColumnType<Date | null, Date | null | undefined, never>;
  expires_at: Date | null;
  responded_at: Date | null;
  updated_at: Generated<Date>;
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
  /** Set once, at insert (trip.started.v1) — never updated afterward. */
  requested_at: ColumnType<Date | null, Date | null | undefined, never>;
  accepted_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  estimated_price: string | null;
  final_price: string | null;
  updated_at: Generated<Date>;
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
  /** Set once, at insert (payment.requested.v1) — never updated afterward. */
  created_at: ColumnType<Date | null, Date | null | undefined, never>;
  paid_at: Date | null;
  updated_at: Generated<Date>;
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
  updated_at: Generated<Date>;
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
