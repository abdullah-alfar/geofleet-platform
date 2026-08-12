# admin-api: Admin Query APIs

Every read-only endpoint the admin dashboard calls — all under
`/api/v1/admin/*`, all requiring an admin bearer token
([authentication.md](authentication.md)) plus a `*.view` permission
([permissions.md](permissions.md)), all reading exclusively from the
`admin_read` projections Phase 3/4 built — never core-api's tables
directly.

## Endpoints

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/dashboard/summary` | `dashboard.view` | Live counts + today's totals |
| GET | `/dashboard/regions` | `dashboard.view` | Same, broken down by `region_id` |
| GET | `/drivers` | `drivers.view` | Filtered, cursor-paginated |
| GET | `/drivers/{id}` | `drivers.view` | |
| GET | `/rides` | `rides.view` | Filtered, cursor-paginated |
| GET | `/rides/{id}` | `rides.view` | Includes a milestone `timeline` |
| GET | `/rides/{id}/offers` | `rides.view` | Every offer for this ride, with a computed `is_expired` flag |
| GET | `/trips` | `trips.view` | Filtered, cursor-paginated — always empty today |
| GET | `/trips/{id}` | `trips.view` | Includes a milestone `timeline` — always 404 today |
| GET | `/payments` | `payments.view` | Filtered, cursor-paginated — always empty today |
| GET | `/payments/{id}` | `payments.view` | Always 404 today |

Full request/response schemas: `/docs` (Swagger, non-production only).

## Cursor pagination

Every list endpoint uses keyset pagination
(`src/common/pagination/cursor.ts`) — never `OFFSET`, per the original
spec's Large Dataset Rules. Ordering is always
`(updated_at DESC, <primary key> DESC)`; the cursor is an opaque
base64url-encoded `{updatedAt, id}` pair naming the last row of the
current page. Stable under concurrent writes from Phase 4's projection
consumers, unlike `OFFSET`, which shifts if rows are inserted mid-scroll.

```json
{ "data": [...], "meta": { "next_cursor": "eyJ1cGRhdGVkQXQi..." } }
```

`next_cursor: null` means there is no next page. `limit` defaults to 20,
capped at 100.

## Two scope decisions

**No `GET /drivers/{id}/timeline` or `GET /trips/{id}/timeline` as
separate endpoints.** `admin_driver_projection` holds current state only
(`last_seen_at`, `last_location_at`) — there's no event-history table
recording how a driver's status/location changed over time, so a real
timeline has no data source. Building one would mean either faking data
or inventing a new append-only event-log table, neither of which was
this phase's scope. `admin_trip_projection` and `admin_ride_projection`
*do* have enough real data for a meaningful timeline — their own
milestone timestamp columns (`requested_at`, `accepted_at`,
`started_at`, etc.) — so that's embedded directly in
`GET /rides/{id}`/`GET /trips/{id}`'s `timeline` field instead of a
separate endpoint. Verified live: a real ride's timeline correctly showed
`requested` → `search_started` in chronological order.

**Dashboard reads live aggregates from the projection tables, not
`admin_region_metrics`.** That table exists (Phase 3) but nothing writes
to it (Phase 4 left its update strategy undecided). The original spec's
"don't compute the dashboard from production tables on every request"
philosophy is about avoiding expensive COUNT/JOIN queries against
core-api's raw transactional tables — `admin_driver_projection`/
`admin_ride_projection`/etc. are already the small, denormalized,
purpose-built tier that philosophy calls for, so querying them directly
(using the indexes [read-models.md](read-models.md) documents) doesn't
reintroduce the problem. Revisit if these queries ever show up as slow at
real data volumes — that's the trigger for building the precomputation
`admin_region_metrics` was reserved for, not before.

## The ride-offer `is_expired` field

There is deliberately no `ride.offer.expired.v1` topic
(`docs/events/topic-catalog.md`) — an offer timing out is treated as an
internal implementation detail of dispatch-service's matching state
machine, not a client-facing event. `GET /rides/{id}/offers` computes
`is_expired` itself (`status === 'pending' && expires_at < now()`) as the
closest honest substitute for "was this offer live or did it lapse" — not
a real event, but derived from real, already-stored data. Verified live
against a ride whose driver never responded: 3 of 4 sequential offers
correctly showed `is_expired: true`, the most recent one `false`.

## Live verification performed

Full stack running (core-api, location-service, dispatch-service,
admin-api), three real admin accounts (`super_admin`, `finance_admin`,
`viewer`), fresh traffic from `scripts/loadtest`:

- **Dashboard freshness windows are real, not decorative.** `online_drivers`
  read `0` against an hour-old dataset (correctly outside the 5-minute
  freshness window), then read exactly `8` immediately after seeding 8
  fresh drivers — an exact match, not a coincidence.
  `average_matching_time_ms` correctly stayed `null` since the load tool
  doesn't simulate driver-side offer acceptance, so nothing was assigned
  in the test window — the query is correct, it simply had nothing
  matching to average.
- **Cursor pagination**: fetched page 1, followed `next_cursor` to page 2,
  confirmed disjoint rows and a further `next_cursor`.
- **Every filter tested against real data**: `availability_status`,
  `region_id` on drivers; `status` on rides — each correctly narrowed
  results, verified by checking every returned row actually matched.
- **Permission enforcement, the actual point of Phase 2's guard chain**:
  `finance_admin` got `403 forbidden` on `/drivers` and `/rides` (missing
  `drivers.view`/`rides.view`) and `200` on `/payments` and
  `/dashboard/summary` (has `payments.view`/`dashboard.view`) — real
  role-based access control working end to end, not just unit-tested
  permission-matching logic in isolation. `viewer` got `200` on every
  endpoint, as designed.
- **Validation**: `rating_from=99` (above the DTO's `@Max(5)`) correctly
  rejected with `400 validation_failed` and a field-level message.
- **404s carry resource-specific codes** (`driver_not_found`,
  `ride_not_found`) — required a small fix to `AllExceptionsFilter` to
  read a custom `code` off the exception body, not just the generic
  status-derived one.

## A bug caught only by a real DI failure, not `tsc`

Every new controller's `@UseGuards(AuthGuard, PermissionsGuard)` needs
Nest to resolve `AuthGuard`'s own constructor dependency
(`TokenVerificationService`) *within that controller's module* — `tsc`
has no way to check this, since it's a runtime DI wiring concern, not a
type. The app crashed on boot with `UnknownDependenciesException` until
every new feature module (`dashboard`, `drivers`, `rides`, `trips`,
`payments`) added `imports: [AuthModule]`. Caught immediately by actually
starting the server, not by any static check.
