# admin-api: Realtime operations (Phase 7)

The only part of admin-api that reads Redis for anything beyond a health
ping — see [architecture.md](architecture.md). Everything else in
admin-api reads core-api's own tables live, through core-api's
`internal/v1` API ([query-apis.md](query-apis.md)); this module exists
because even a live read of core-api's Postgres tables doesn't have a
driver's current GPS position at all — that state only ever lives in
dispatch-service's own Redis index, not in any table core-api owns — so
"where is this driver, this second" has exactly one real source, and
this is the only place in admin-api that reads it.

## Why Redis, and which keys

`apps/dispatch-service` already maintains exactly the state a live map
needs, for its own matching purposes — `dispatch:driver:{driver_id}`, a
JSON blob (`{lat, lng, geohash, updated_at, available}`) written on every
GPS ping and every availability change (see
`apps/dispatch-service/internal/driverindex/driverindex.go`). admin-api
reads this key, never writes it, and never touches
`dispatch:geocell:{geohash}` (dispatch-service's geohash-cell candidate
index) — region scoping comes from a `GET /internal/v1/drivers?region_id=`
call to core-api (`drivers.region_id`, a real, indexed column), then only
the already-known driver ids are looked up in Redis.
Re-implementing geohash neighbor search in TypeScript to solve a problem
dispatch-service already solves for its own purpose would be pure
duplication for no benefit — this module is a *reader* of an existing
index, not a second implementation of one.

`src/integrations/redis/redis.module.ts` provides a persistent
`ioredis` client (`REDIS_CLIENT`, `@Global()`) — distinct from the Phase 1
health indicator's `lazyConnect`, ping-only client, since this one serves
real read traffic on every request. Same `.on('error', ...)` discipline
as every other shared client in this codebase (an unlistened `error`
event is fatal to the whole Node process, not just the failing call).

## Endpoints

All three live under `/api/v1/admin/realtime`, gated by `AuthGuard` +
`PermissionsGuard`, and throttled tighter than the platform's 100/min
default (`app.module.ts`) — these are meant to be polled by a live
dashboard widget, not browsed, so a tight per-route `@Throttle()` limit
protects Redis from an accidental tight-poll loop without blocking the
intended usage pattern.

| Route | Permission | Throttle | Source |
|---|---|---|---|
| `GET /realtime/regions/:regionId/drivers` | `drivers.view` | 20/min | core-api (region → driver ids) + Redis (position) |
| `GET /realtime/regions/:regionId/counters` | `dashboard.view` | 30/min | core-api (region → driver ids) + Redis (presence/availability) |
| `GET /realtime/incidents` | `dashboard.view` | 30/min | core-api (`GET /internal/v1/rides`, `/trips`, `order=oldest`) + Redis (driver presence) |

### Driver map and live counters

Both start from the same call — `GET /internal/v1/drivers?region_id=...`
against core-api, capped at `MAX_MAP_DRIVERS` (500; an admin map isn't
meant to render thousands of pins, and no region in this platform is near
that scale today — a hard cap, not real pagination, since a live-polling
map can't reasonably page through "the rest" the way a browsable list
can) — then one pipelined `MGET dispatch:driver:{id}` for every id in
that page (one Redis round trip, not N). A driver only appears if their key exists
**and** is fresh (see below); everyone else is silently omitted, not an
error — a live map degrading by one missing pin beats a 500 for everyone.

The counters endpoint is deliberately separate from the driver map, not
a derived field on it: a counter widget that refreshes every couple of
seconds shouldn't have to pull full driver coordinate arrays on every
poll just to show two numbers.

### What "live" means here — and a real bug freshness caught

A `dispatch:driver:{id}` key *existing* is not the same as it being
*trustworthy*. Caught live during this phase's own verification: a driver
suspended and then deleted (Phase 6's own test data) left behind a key
with `{lat: 0, lng: 0, updated_at: "0001-01-01T00:00:00Z"}` — Go's zero
time, from `SetAvailability` being called with no location ever cached
for that driver — which would otherwise have rendered a phantom pin at
0,0 ("null island") for up to 30 minutes (the key's own TTL) after the
driver no longer existed. Fixed by checking freshness, not just presence,
everywhere this state is read: `isFresh()` compares `updated_at` against
`STALE_LOCATION_AGE_MS` (60s) — **the exact same threshold
dispatch-service itself already uses**
(`STALE_LOCATION_AGE` in `apps/dispatch-service/.env.example`) when
deciding whether to trust a candidate's cached position during matching.
Reusing it here means "live" means the same thing in both places, not a
second, independently-chosen number.

### Incidents

Two computed signals, not a new incidents table or domain model — every
value comes from data this platform already has:

1. **`stale_searching_ride`** — a ride request still `status = 'searching'`
   after `STALE_SEARCHING_THRESHOLD_MS` (2 minutes — several multiples of
   dispatch-service's own `OFFER_TTL`, 15s per offer; a ride still
   searching that many offer-cycles later has likely exhausted nearby
   candidates, not just mid-match). Fetched via
   `GET /internal/v1/rides?status=searching&date_to=<threshold>&order=oldest`.
2. **`silent_driver_on_trip`** — a trip `status = 'in_progress'` whose
   driver has no fresh `dispatch:driver:{id}` state (missing, or stale by
   the same `isFresh()` check the driver map uses) — a driver who's gone
   quiet mid-trip. Fetched via
   `GET /internal/v1/trips?status=in_progress&order=oldest`.

Both calls are capped at `MAX_INCIDENTS_PER_TYPE` (100), oldest/worst
first (core-api's own `order=oldest` sorts by the staleness-defining
timestamp ascending — see [query-apis.md](query-apis.md)) — caught
live: this platform's earlier load-testing phases left **86 real** ride
requests genuinely stuck in `searching` for 5+ hours (no driver ever
available at the time they were created, and nothing ever swept them to
`unavailable`). An uncapped query would have returned all of them; the
cap keeps the worst offenders rather than an arbitrary slice, the same
"don't return an unbounded result" rule the rest of this codebase already
applies to list endpoints (cursor pagination, Phase 5).

## What today's live verification could and couldn't exercise organically

- **Driver map + live counters**: fully organic. `scripts/loadtest` run
  against a live stack (location-service + dispatch-service + core-api)
  produced real `dispatch:driver:{id}` keys with real Amman-area
  coordinates; both endpoints returned them correctly, and the counters
  matched the driver count exactly (6/6).
- **`stale_searching_ride` incidents**: fully organic — 86 real rows
  already existed from earlier phases' load testing, no fabrication
  needed. This is arguably the most valuable finding of this phase: a
  real, pre-existing operational gap (ride requests that were never
  resolved to `unavailable`) that had no visibility anywhere in the
  platform until this endpoint existed.
- **`silent_driver_on_trip` incidents**: could not be exercised
  organically — same standing gap documented elsewhere (nothing in
  core-api creates `trips` rows yet). Verified against one row inserted
  directly into core-api's own `trips` table (`Trip::forceCreate()`,
  `status = 'in_progress'`, a random driver id with no Redis key — same
  "manufactured, documented, deleted afterward" precedent Phase 6 used),
  confirmed detected via `GET /realtime/incidents`, then deleted.
- **Permission enforcement**: real — `operations_admin` (has
  `drivers.view`) succeeded on the driver map; `finance_admin` (does not)
  got `403`; both succeeded on counters (`dashboard.view`, which both
  roles have).
- **Throttling**: real — 22 rapid requests against the driver-map
  endpoint (limit 20/min) returned `200` for the first 20 and `429` for
  the rest.
