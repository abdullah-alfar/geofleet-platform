# admin-api: Admin Query APIs

Every read-only endpoint the admin dashboard calls — all under
`/api/v1/admin/*`, all requiring an admin bearer token
([authentication.md](authentication.md)) plus a `*.view` permission
([permissions.md](permissions.md)). Each one is a thin proxy: admin-api
calls core-api's own `internal/v1` API synchronously
(`CoreApiClientService`, the same shared-secret client Phase 6 built for
commands — [laravel-integration.md](laravel-integration.md)) and reshapes
the response. **admin-api keeps no local read model of its own.**

## Kafka projections retired

Phases 3–5 built this the other way: a Kafka consumer projected 9 live
topics into admin-api's own `admin_read` Postgres schema, and every
endpoint below read from that instead. That's gone —
`KafkaModule`/every projection handler/the Kysely `DatabaseModule`/the
`admin_read` schema itself are all deleted, not disabled. See
[architecture.md](architecture.md#kafka-projections-retired---reads-go-straight-to-core-api)
for the full reasoning. Short version: admin traffic is low-volume
enough that the eventual-consistency lag and second-schema-to-maintain
cost of a projection wasn't buying anything real, and it caused a
concrete bug (a driver's list-view status permanently unable to reflect
an admin command someone had already run, because no event carried it) —
reading core-api's own tables directly has no such gap, since it's the
same data core-api itself operates on.

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

Full request/response schemas: `/docs` (Swagger, non-production only).

## Cursor pagination

Every list endpoint uses keyset pagination — never `OFFSET`, per the
original spec's Large Dataset Rules. core-api does the actual paginated
query and cursor encoding now (`App\Support\CursorPagination`, mirroring
admin-api's old TS scheme exactly: base64url `{value, id}`); admin-api
forwards the `cursor`/`limit` query params through unchanged and returns
core-api's `{data, meta}` response as-is. Ordering is `(updated_at DESC,
<uuid> DESC)` by default; core-api's realtime-serving list calls
(the incident feed) pass `order=oldest` to sort by the ride/trip's own
timestamp ascending instead, since that use case wants "the N oldest
stuck items," not a browsable page.

```json
{ "data": [...], "meta": { "next_cursor": "eyJ2YWx1ZSI6Ii4uLiJ9" } }
```

`next_cursor: null` means there is no next page. `limit` defaults to 20,
capped at 100 (core-api itself accepts up to 500 — used internally by
`RealtimeService`'s region driver-map/counters calls, which aren't a
browsable list and need the whole region in one shot).

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
