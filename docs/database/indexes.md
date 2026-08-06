# Index Catalog

Every index below exists because it supports a specific, named query — per
AGENTS.md ("Before adding an index, explain the query it supports"). This
mirrors the inline comments in the migration files; kept here as a single
reference.

## users

| Index | Supports |
|---|---|
| `email` unique | Login lookup by email; prevents duplicate accounts. |
| `phone` unique | Prevents duplicate phone-based accounts. |
| `uuid` unique | Public identifier lookups (route model binding). |
| `(region_id, role)` | "Active drivers/customers in region X" admin/reporting filters. |
| CHECK `role` | Constrains to `customer`/`driver`/`admin`. |
| CHECK `status` | Constrains to `active`/`suspended`/`disabled`. |

## customers / drivers

| Index | Supports |
|---|---|
| `customers.user_id` unique | One customer profile per user. |
| `drivers.user_id` unique | One driver profile per user. |
| `drivers.license_number` unique | Prevents duplicate driver licenses across accounts. |
| `drivers.(region_id, status, is_available)` | "Active, available drivers in region X" reporting query (the hot-path dispatch candidate search itself runs against Redis/H3, not this index — see Phase 5). |
| CHECK `drivers.status` | Constrains to `pending_review`/`active`/`suspended`/`disabled`. |
| CHECK rating ranges | `rating` between 1.00–5.00 on both tables; `acceptance_rate` between 0–1 on drivers. |

## vehicles

| Index | Supports |
|---|---|
| `plate_number` unique | Prevents duplicate plates across the platform. |
| `driver_id` (btree) | "List vehicles for driver X" (profile/admin views). |
| `vehicles_one_active_per_driver` (partial unique, `WHERE is_active = true`) | Enforces "one active vehicle per driver" atomically — a race between two concurrent "set active" requests cannot both succeed, no read-then-write needed. |
| CHECK `vehicle_type`, `status` | Constrained value sets. |

## driver_devices

| Index | Supports |
|---|---|
| `device_identifier` unique | One device belongs to exactly one driver. |
| `token_hash` unique | Device token lookup during GPS-update authentication (Phase 3); collision would mean two devices sharing a credential, which must be impossible. |
| `(driver_id, status)` | "Does this driver have any active devices?" / device list on account page. |
| CHECK `platform`, `status` | Constrained value sets. |

## ride_requests

| Index | Supports |
|---|---|
| `uuid` unique | Public identifier; also the Kafka partition key for `ride.*` events. |
| `(customer_id, idempotency_key)` unique | Detects a retried POST /ride-requests with the same client-supplied key, scoped per customer (keys are client-generated, not globally coordinated). Postgres treats NULL as distinct, so requests without a key are never deduplicated against each other. |
| `(customer_id, status)` | Customer's ride-request history; ownership check on GET/cancel. |
| `(region_id, status)` | dispatch-service's future consumer picking up `searching` requests within a region. |
| `(driver_id, status)` | Driver-side "my current/past ride requests". |
| `pickup_location` GiST (spatial) | PostGIS radius/nearest-driver-style queries against pickup point (used directly once dispatch-service exists in Phase 5). |
| CHECK `status`, `requested_vehicle_type` | Constrained value sets. |

## ride_offers

| Index | Supports |
|---|---|
| `(ride_request_id, driver_id)` unique | Prevents dispatch-service from offering the same ride to the same driver twice concurrently. |
| `(driver_id, status)` | "Does this driver have a pending offer right now?" check before creating a new one. |
| `(status, expires_at)` | The offer-expiration sweep (Phase 5/7) selecting pending offers whose `expires_at` has passed. |
| CHECK `status` | Constrained value set. |

## trips

| Index | Supports |
|---|---|
| `ride_request_id` unique | One trip per ride request. |
| `(customer_id, status)` | Customer's trip history / current trip. |
| `(driver_id, status)` | Driver's trip history / current trip. |
| `pickup_location`, `dropoff_location` GiST (spatial) | PostGIS queries over completed-trip pickup/drop-off points (e.g. demand heatmaps — brief's spatial design section). |
| CHECK `status` | Constrained value set. |

## trip_status_history

| Index | Supports |
|---|---|
| `(trip_id, occurred_at)` | Rendering a trip's full timeline in chronological order (support/audit use cases). |
| CHECK `status` | Constrained to the same set as `trips.status`. |

## payments

| Index | Supports |
|---|---|
| `trip_id` unique | One payment per trip (MVP). |
| `provider_reference` unique | Prevents double-processing the same external payment provider transaction. |
| `(customer_id, status)` | Customer's payment/billing history. |
| `status` | Admin filtering (e.g. finding failed payments to retry). |
| CHECK `status`, `amount >= 0` | Constrained value set / non-negative amounts. |

## outbox_events

| Index | Supports |
|---|---|
| `outbox_events_unpublished_idx` (partial, `WHERE published_at IS NULL`, on `created_at`) | The publisher's core query: "select unpublished events, oldest first". A partial index keeps it small indefinitely since published rows — the overwhelming majority over time — are excluded entirely, rather than a plain composite index that would keep growing. |
| `(aggregate_type, aggregate_id)` | "All events for this aggregate" debugging/replay lookups. |
| `event_id` unique | Kafka message identity; also what consumer-side inbox records reference. |

## inbox_events

| Index | Supports |
|---|---|
| `(consumer_name, event_id)` unique | The entire point of the table: "has `consumer_name` already processed `event_id`?" — the unique constraint doubles as the lookup index. |

## audit_logs

| Index | Supports |
|---|---|
| `(auditable_type, auditable_id)` | "History of changes to this record" (e.g. a trip's full audit trail). |
| `(actor_type, actor_id)` | "Everything this actor did" (security review, abuse investigation). |
| `occurred_at` | The future retention/pruning job selecting rows older than a cutoff (see docs/database/retention.md, added when retention policies are implemented). |
