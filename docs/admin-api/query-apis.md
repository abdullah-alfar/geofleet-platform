# admin-api: Admin Query APIs

Every read-only endpoint the admin dashboard calls — all under
`/api/v1/admin/*`, all requiring an admin bearer token
([authentication.md](authentication.md)) plus a `*.view` permission
([permissions.md](permissions.md)). Each one runs a parameterized SQL
query directly against core-api's own Postgres tables (`pg`, no query
builder) and reshapes the rows into the response shape below — no HTTP
call to core-api anywhere in this path anymore. See
[ADR 0011](../decisions/0011-admin-api-independent-service.md); the
`*.service.ts` file for each module (e.g.
`src/modules/drivers/drivers.service.ts`) is the source of truth for the
exact query. **admin-api keeps no local read model of its own** — same
principle as before, just a direct connection instead of a proxied one.

## History: two earlier designs, both retired

This is the *third* shape this read path has taken:

1. **Phases 3–5**: a Kafka consumer projected 9 live topics into
   admin-api's own `admin_read` Postgres schema. Retired — eventual-
   consistency lag and a second schema to maintain weren't buying
   anything real for low-volume admin traffic, and it caused a concrete
   bug (a driver's list-view status permanently unable to reflect an
   admin command someone had already run, because no event carried it).
2. **Phase 6 through 7**: admin-api called core-api's own `internal/v1`
   API synchronously (`CoreApiClientService`) and reshaped the response
   — a thin proxy, no local storage at all. Also retired — see
   [ADR 0011](../decisions/0011-admin-api-independent-service.md) for
   why the extra network hop and the coupling to core-api's uptime
   weren't worth it either, once the same guard/audit/outbox logic could
   be replicated directly.
3. **Current (Phase 8)**: direct SQL, as described above.

See [architecture.md](architecture.md#kafka-projections-retired---reads-go-straight-to-core-api)
for the full phase-by-phase history.

## Endpoints

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/dashboard/summary` | `dashboard.view` | Live counts + today's totals, computed by core-api against its own tables |
| GET | `/dashboard/regions` | `dashboard.view` | Same, broken down by `region_id` |
| GET | `/drivers` | `drivers.view` | Filtered, cursor-paginated |
| GET | `/drivers/{id}` | `drivers.view` | Includes a real `name`/`phone_masked` — no Kafka event ever carried a driver's name; reading `users`/`drivers` directly does |
| GET | `/rides` | `rides.view` | Filtered, cursor-paginated |
| GET | `/rides/{id}` | `rides.view` | Includes a milestone `timeline` — `requested`/`accepted`/`cancelled` only, `ride_requests`' own real columns |
| GET | `/rides/{id}/offers` | `rides.view` | Every offer for this ride, with a computed `is_expired` flag |
| GET | `/trips` | `trips.view` | Filtered, cursor-paginated — reads `trips` directly; empty today only because nothing in core-api creates a `trips` row yet, a separate platform gap |
| GET | `/trips/{id}` | `trips.view` | Includes a milestone `timeline` — `started`/`completed`/`cancelled` |
| GET | `/payments` | `payments.view` | Filtered, cursor-paginated — same "empty until core-api creates payments" gap as trips |
| GET | `/payments/{id}` | `payments.view` | |
| GET | `/customers` | `customers.view` | Filtered, cursor-paginated |
| GET | `/customers/{id}` | `customers.view` | Includes `total_rides`/`total_trips` (`loadCount`, detail only — not on the list, to avoid an aggregate per row of a paginated page) |

Full request/response schemas: `/docs` (Swagger, non-production only).

## Customers had no admin-facing read path at all before this

Every other domain here (drivers/rides/trips/payments) already had at
least a resource and a route before this. Customers had neither: no
`CustomerController`, no route beyond the comment
`// --- Customer-only: ride requests ---` in `routes/api.php`
(customers as *actors* placing ride requests, not as a *manageable
resource*). An admin could see a bare `customer_id` UUID embedded in a
ride/trip/payment row and nothing else. `CustomerQueryController`
(core-api) and the `customers` module (admin-api) close that gap the
same way every other domain here works — `AdminCustomerResource` reads
`customers` joined to `users` (name/email/phone_masked/status/region_id
live on `users`, not `customers` — a customer's own table only ever held
`rating`). `phone_masked` uses a small shared helper
(`App\Support\PhoneMask`) now, factored out of `AdminDriverResource`
rather than duplicated a second time.

## Cursor pagination

Every list endpoint uses keyset pagination — never `OFFSET`, per the
original spec's Large Dataset Rules. admin-api does the paginated query
and cursor encoding itself now (`src/common/pagination/cursor.ts` —
`encodeCursor`/`decodeCursor`/`cursorWhereFragment`/`paginateRows`,
shared by every module), a direct TypeScript port of core-api's own
`App\Support\CursorPagination` (same base64url `{value, id}` scheme,
same `(orderColumn, idColumn) < (cursor)` row-comparison logic — just
built as a Postgres row-constructor comparison directly rather than
Laravel's OR-based equivalent). Ordering is `(updated_at DESC, <uuid>
DESC)` by default; `RealtimeService`'s incident-feed calls into
`RidesService`/`TripsService` pass `order: 'oldest'` to sort by the
ride/trip's own timestamp ascending instead, since that use case wants
"the N oldest stuck items," not a browsable page.

```json
{ "data": [...], "meta": { "next_cursor": "eyJ2YWx1ZSI6Ii4uLiJ9" } }
```

`next_cursor: null` means there is no next page. `limit` defaults to 20,
capped at 100 — `RealtimeService`'s region driver-map/counters calls
pass up to 501 directly to `DriversService.list()` internally (a
same-process method call now, not an HTTP request bound by the public
endpoint's own cap), since that use case needs the whole region in one
shot, not a browsable page.

## Two scope decisions

**No `GET /drivers/{id}/timeline` as a separate endpoint.** No table
anywhere in this platform records how a driver's status/location changed
over time — core-api's `drivers` row holds current state only. Building
one would mean inventing a new append-only event-log table, out of
scope here. `GET /rides/{id}`/`GET /trips/{id}` *do* embed a `timeline`
field — their own real milestone timestamp columns
(`requested_at`/`accepted_at`/`cancelled_at` on `ride_requests`;
`started_at`/`completed_at`/`cancelled_at` on `trips`) are real data,
not derived or invented.

**Dashboard reads live aggregates directly from core-api's own tables.**
No precomputed `admin_region_metrics` table anymore — that existed to be
fed by a Phase 4 projection consumer that no longer runs. The original
spec's "don't compute the dashboard from production tables on every
request" philosophy is about avoiding expensive COUNT/JOIN queries
against a high-traffic OLTP schema; core-api's `drivers`/`ride_requests`/
`trips`/`payments` tables are already indexed for exactly these access
patterns (`region_id`/`status` composite indexes — see each table's own
migration), and admin traffic is low-volume enough that a handful of
indexed COUNT queries per dashboard load isn't the problem that
philosophy warns about. Revisit if these queries ever show up as slow at
real data volumes.

## The ride-offer `is_expired` field

There is deliberately no `ride.offer.expired.v1` topic
(`docs/events/topic-catalog.md`) — an offer timing out is treated as an
internal implementation detail of dispatch-service's matching state
machine, not a client-facing event. `GET /rides/{id}/offers` computes
`is_expired` itself (`status === 'pending' && expires_at < now()`,
now computed in `AdminRideOfferResource`, core-api) as the closest
honest substitute for "was this offer live or did it lapse" — not a real
event, but derived from real, already-stored data.

## `online_drivers` redefined

The dashboard's `online_drivers` field used to mean "sent a heartbeat
recently" (from `driver.location.validated.v1`'s `last_seen_at`) — a
concept that only ever lived in the Kafka event stream, never in
core-api's own tables (core-api has no heartbeat table; that data lived
in location-service's Redis). Reading core-api directly instead of
waiting for an event means this field is now `status = 'active'`
(approved and in the fleet) — a real, stable core-api concept, distinct
from `available_drivers` (`is_available = true`, actively looking for
rides right now). Both are meaningful; neither pretends to be a
heartbeat. See `DashboardQueryController` (core-api) for the exact
definition.

## Live verification performed

Full stack running (core-api, admin-api, admin-web), a real browser
session against a real admin login:

- `GET /api/internal/v1/drivers/{id}` (core-api, directly) returned a
  real `name`/`phone_masked`/`status` for the platform's one real test
  driver — the exact field this whole migration was meant to fix (a
  driver's name never showing in admin-web, since no Kafka event ever
  carried one). Confirmed rendered correctly in admin-web's own drivers
  list and detail pages ("Test Driver", not a blank cell).
- A command response (`PATCH .../unsuspend`) round-tripped correctly as
  a flat object, not wrapped in `{"data": {...}}` — caught and fixed a
  real, separate pre-existing bug along the way: Laravel's `JsonResource`
  wraps single-resource responses in a `data` key by default, and every
  command controller (`DriverCommandController`, `TripCommandController`,
  `PaymentCommandController`, `AdminAccountController`) was returning a
  bare Resource, so `result.status` in admin-web's own success messages
  had silently been `undefined` since Phase 6. Fixed by returning
  `(new XResource(...))->resolve()` (a plain array, not auto-wrapped)
  from every command and new query `show()` method. Verified in-browser:
  clicking "Suspend driver" now shows "Driver suspended (status:
  suspended)." — a real status, not `undefined` — and the detail view's
  own fields update immediately on refresh, no lag.
- Every admin-web page exercised in a real browser against this live
  stack: dashboard (real region breakdown), drivers list/detail/suspend/
  unsuspend, rides list/detail/offers, trips (correctly empty), payments,
  realtime (driver map/counters/incidents), admin accounts (including the
  caller's own row correctly marked "(you)" and hiding its own
  deactivate control). Zero server errors, zero failed network requests,
  zero browser console errors across the whole pass.
- **A second real bug caught in this same pass**: `RealtimeService`
  requests `limit: MAX_MAP_DRIVERS + 1` (501) from
  `GET /internal/v1/drivers` to distinguish "exactly 500 drivers" from
  "truncated" — but `DriverQueryController`'s own validation capped
  `limit` at 500, so every driver-map/counters request failed with
  `400 validation_failed` ("The given data was invalid"), surfaced
  directly in the live map page. Fixed by raising that one endpoint's
  cap to 501, with a comment explaining why it's not the same 500 every
  other list endpoint uses.
