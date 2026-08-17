# Developer test flow: zero to a verified working platform

A single walkthrough for a new developer: nothing installed, nothing
running, to having exercised the real distributed ride lifecycle
end-to-end and knowing what "it worked" actually looks like at every
step. Two halves:

1. **Setup** — get every service running. Covered in depth by
   [local-development-without-docker.md](local-development-without-docker.md);
   this doc only summarizes the checklist and links into it.
2. **Test** — run [scripts/api-test/](../scripts/api-test/) in order,
   with the expected result of each step spelled out, so you can tell a
   real failure from expected behavior without guessing.

If you just want to run everything with no reading, `./run-all.sh` does
steps 01–12 in one shot (see [scripts/api-test/README.md](../scripts/api-test/README.md)).
This doc is for the first time through, when you actually want to
understand what each step proves.

## Part 1 — Setup: what "running" means here

Full instructions: [local-development-without-docker.md](local-development-without-docker.md).
The short version — you need **8 terminals** open by the end:

| # | Terminal runs | Section |
|---|---|---|
| 1 | Postgres (systemd, already running) | [§2](local-development-without-docker.md#2-infrastructure--postgres-redis-kafka-all-on-default-ports) |
| 2 | Redis (systemd, already running) | same |
| 3 | Kafka (`kafka-server-start.sh`) | same |
| 4 | core-api: `php artisan serve` | [§3](local-development-without-docker.md#3-core-api-laravel) |
| 5 | core-api: `watch -n 2 php artisan outbox:publish` | same |
| 6 | location-service: `go run ./cmd/location-service` | [§4](local-development-without-docker.md#4-go-services) |
| 7 | dispatch-service: `go run ./cmd/dispatch-service` | same |
| 8 | realtime-gateway: `go run ./cmd/realtime-gateway` | same |

admin-api (`npm run start:dev`, [§5](local-development-without-docker.md#5-admin-api-nestjs))
is a 9th terminal, only needed for script 14.

**Terminal 5 is the one people forget and the one that causes almost
every "nothing is happening" confusion below.** core-api writes events
to an `outbox_events` table, not straight to Kafka (the transactional
outbox pattern — see `App\Domain\Outbox\Outbox`). Nothing reaches Kafka,
and therefore nothing reaches dispatch-service or realtime-gateway,
until that `outbox:publish` loop is actually polling. If ride requests
seem to hang at `status: searching` forever, check this terminal first.

### Expected: infrastructure is up

Run `00-health-check.sh` (see Part 2) — every line should be green
`2xx`. If anything is red, that's the service to go start; the script
tells you which terminal command starts it.

### A note on timezones — two conventions, both correct

core-api's `APP_TIMEZONE` (`apps/core-api/.env`) can be set to whatever
you want — it drives both PHP's clock and the Postgres session together
(`config/app.php`, `config/database.php`'s `pgsql.timezone`), so they
can't drift apart from each other. This environment currently runs
`Asia/Amman`. That setting changes **raw Postgres rows only** — every
HTTP response every script in this kit reads is unaffected, because
Laravel's JSON serialization (`Carbon::toJSON()`) always normalizes to
UTC on the way out, regardless of `APP_TIMEZONE`. Confirmed live, same
row, both ends:

| Where you're looking | Value | Timezone |
|---|---|---|
| JSON API response (`req`'s output, every script) | `2026-08-17T11:13:09.000000Z` | always UTC |
| Raw `psql` query on the same row | `2026-08-17 14:13:09+03` | `APP_TIMEZONE` (Amman) |

So: nothing in `scripts/api-test/` needs adjusting for this, ever — GPS
timestamps (`08`'s `RECORDED_AT`) already use `date -u` explicitly,
uniqueness stamps use epoch seconds, and Kafka event envelopes
(`occurred_at`) are always UTC-with-`Z` by convention regardless of any
service's local config. The only place the two conventions can collide
is if you go around the API and query Postgres directly mid-debug (as
the stale-GPS investigation above did) — a `psql` row's timestamp will
be in local Amman time while everything printed by the scripts stays
UTC. Both are correct; they're just not the same clock.

## Part 2 — Test: scripts/api-test, in order

Each script prints a `step` banner naming the exact source file/method
it's about to exercise — open that file in another window as you go.
Full per-script reference table: [scripts/api-test/README.md](../scripts/api-test/README.md).
What follows is what to *expect* at each step, not just what each
script does.

```bash
cd scripts/api-test
```

### 00 — health check

```
core-api        -> 200
location-service -> 200 (x2: healthz, readyz)
dispatch-service -> 200 (x2)
realtime-gateway -> 200 (x2)
admin-api        -> 200 (optional)
```
Expect all green. This has no auth and touches no state — safe to run
any time, first thing, and again any time something later looks wrong.

### 01 — register customer

Expect `201`, body `data.id` (a uuid) and `meta.token` (a Sanctum token,
`"<id>|<random>"` shape — note the literal `|`, relevant if you ever
hand-edit `.state`). Saves `CUSTOMER_TOKEN`, `CUSTOMER_ID`.

### 02 — register driver

Expect `201`, `data.driver.status = "pending_review"`. This is
correct, not a bug — a freshly-registered driver can log in and add a
vehicle but can't go available or be matched yet. Saves `DRIVER_TOKEN`,
`DRIVER_ID`.

### 03 — login (+ 2 negative cases)

Three sub-checks in one script:
- Correct password → `200`, a *new* token (tokens aren't rotated —
  the old one from 01/02 still works too).
- Wrong password → `422` (Laravel `ValidationException`, not `401`) —
  and the same error whether the email exists or not, deliberately.
- `/auth/me` with no token → `401`, before `AuthController::me` ever
  runs — Sanctum's route middleware rejects it first.

### 04 — add vehicle

Expect `201` from the `POST`, then `200` from the follow-up `GET
/drivers/vehicles` listing that same vehicle back. Saves `VEHICLE_ID`.

### 05 — register device

Expect `201`, `meta.device_token` present. **This is the only time
you'll ever see that token in plaintext** — only its SHA-256 hash is
stored server-side. Saves `DEVICE_ID`, `DEVICE_TOKEN`. If a later
script needs `DEVICE_TOKEN` and it's missing, re-run this one — there's
no way to recover a lost plaintext device token, only issue a new one.

### 06 — admin-approve driver

First run also provisions a throwaway `super_admin` via
`php artisan admin:create` (needs `php` on `PATH` and Postgres reachable
from your shell, not just from core-api's process). Expect `200`,
driver status now `"active"`. Re-running this script for the same
driver is expected to return `409` — the controller's own idempotency
guard (`Driver::where('status','pending_review')` affects 0 rows the
second time), not a broken script.

### 07 — go available

Expect `200`. This succeeds even if the driver is still
`pending_review` — only `suspended` blocks it. A `pending_review`
driver going "available" just won't ever get matched later; that's the
part 06 actually gates, not this step.

### 08 — submit GPS

Expect `200`. If you run this script twice back-to-back with no delay,
expect a `429` — location-service rate-limits at
`MAX_UPDATES_PER_WINDOW` (default 2) per `RATE_LIMIT_WINDOW` (default
1s). That's `internal/validation` working, not flakiness.

**This is the step that puts something on Kafka** — confirmed live:
running it once increments the offset on both `driver.location.received.v1`
and `driver.location.validated.v1` by exactly 1 (verified via
`kafka-get-offsets.sh` before/after). Watch it happen yourself with
`../16-tail-kafka.sh` running in another terminal first.

**GPS freshness is a hard cutoff, not a suggestion — re-run this right
before 09, every time.** `internal/matching/matching.go`'s
`findCandidates()` rejects any driver whose last Redis location
timestamp is older than `STALE_LOCATION_AGE` (`.env`, default `60s`):
```go
if state == nil || !state.IsAvailable || now.Sub(state.UpdatedAt) > m.cfg.StaleLocationAge {
    continue // candidate skipped
}
```
07 (availability) doesn't expire; 08 (location) does, on its own
60-second clock, independent of 07. Run 07 once per session if you
want, but run **08 immediately before every 09** — if you come back to
a session after a break and jump straight to 09/10 on old state, the
driver will silently fail this check and the ride will resolve straight
to `unavailable` (see below) with no error anywhere in the loop, since
nothing is actually broken — the driver genuinely is too stale to
trust.

### 09 — create ride request

Expect `201`, `data.status = "searching"`. This is the step that
actually starts the distributed part — the write also drops a
`ride.requested.v1` row in `outbox_events`. It will **not** move past
`searching` until both terminal 5 (`outbox:publish`) is running and a
driver from 06+07+08 (with **fresh**, not just any, GPS — see 08 above)
is available nearby. Saves `RIDE_REQUEST_ID`.

### 10 — check offers (polls, up to 10x with 1.5s delay)

Expect an offer to show up within a few seconds — matching happens
asynchronously in dispatch-service, triggered by consuming
`ride.requested.v1`, not by this poll (this just reads whatever
`internal/offerstore` already has). Saves `OFFER_ID`.

**If nothing shows up after 10 attempts**, the script prints its own
checklist — in order of likelihood:
1. Is terminal 5 (`outbox:publish`) actually running?
2. Did 06 run for *this* driver (must be `active`, not
   `pending_review`)?
3. Did 07 and 08 both run for *this* driver — **and was 08 run within
   the last 60 seconds of 09**, not just once earlier in the session?
   (`SELECT status FROM ride_requests ORDER BY created_at DESC LIMIT 1;`
   showing `unavailable` instead of `searching` confirms matching
   already ran and rejected everyone — polling longer won't help, that
   request is resolved for good; you need a fresh 08 + a fresh 09.)
4. Does dispatch-service's own log show it consumed
   `ride.requested.v1` at all?

### 11 — accept offer (+ negative case)

Expect `200` the first time, body `{"status":"accepted", "ride_request_id": "..."}`.
The script then immediately tries accepting the **same** offer again on
purpose — expect `409 offer_not_available` there. That's the atomic
conditional-UPDATE guarantee in `internal/offerstore/store.go` working
(the second UPDATE affects 0 rows), the actual point of this test, not
an error.

**Run this immediately after 10 — `OFFER_TTL` (`apps/dispatch-service/.env`)
is 15 seconds by default.** If you read the offer 10 printed, then
switched terminals or paused to look something up before running 11,
you can easily blow past 15 seconds by hand — dispatch-service's own
expiry sweep resolves the offer to `expired` in the background the
moment its TTL passes, with nobody needing to touch it. When that
happens, **the *first* accept attempt also comes back `409
offer_not_available`**, not just the intentional second one — same
error code as the real double-accept case, different actual cause.
Tell them apart with:
```sql
select status, offered_at, expires_at, responded_at from ride_offers where uuid = '<OFFER_ID>';
```
`status = 'expired'` and `responded_at` a second or two after
`expires_at` means the clock beat you, not a bug — just re-run 08 → 09
→ 10 → 11 back-to-back with no pause in between. `status = 'accepted'`
with a `responded_at` from a driver other than yours would mean an
actual race, which shouldn't happen in this kit (only one driver
exists per run) but is what the guarantee is actually protecting
against in production.

### 12 — verify ride assigned

Expect `GET /ride-requests/{id}` to now show `data.status = "accepted"`
and a populated `data.driver` object — this is confirmation that 4
services (core-api, Kafka, dispatch-service, core-api again) agreed
purely through events, with no service calling another directly.

The follow-up `GET /trips` is expected to come back **empty** — this
is a known, documented platform gap (nothing consumes
`ride.assigned.v1` to create a `trips` row yet), not something broken
in this kit. The ride lifecycle these scripts can exercise stops at
`accepted`.

### 13 — cancel ride request (+ 2 negative cases)

Independent of 09–12 (creates its own ride request). Expect: cancel →
`200`; cancel again → `422` (`ride_requests.status` no longer in
`['searching','offered']`); a note pointing you at
`RideRequestPolicy` for the 403 case, left for you to try with a second
customer's token.

### 14 — admin-api session (needs admin-api running)

Expect `200` from `GET /api/v1/admin/session` with a valid admin token,
`401` with none, and a populated drivers list on
`GET /api/v1/admin/drivers`. Confirms admin-api independently
re-verifies the core-api token itself rather than trusting a claim.

### 15 — realtime WebSocket (run in its own terminal, before 09–11)

```bash
./15-realtime-ws.py          # terminal A — connects and waits
# terminal B, after 01/02 ran:
./09-create-ride-request.sh
./10-check-offers.sh
./11-accept-offer.sh
```
Expect terminal A to print a `ride.assigned.v1` event the instant 11
succeeds — no polling. If nothing prints, the same "is `outbox:publish`
running?" checklist from step 10 applies, plus: is realtime-gateway's
own terminal (8) actually up?

### 16 — tail Kafka (run in its own terminal, any time)

```bash
./16-tail-kafka.sh                    # all topics, live
./16-tail-kafka.sh --from-beginning   # all topics, replay
```
Expect raw event envelopes to print as other scripts run. If you start
this and *immediately* trigger a publish in the same breath, that first
message can be missed — the consumer group needs a moment to finish
joining before it's actually subscribed. Not a bug; use
`--from-beginning` or wait a beat after the "Tailing..." banner. Full
detail in [scripts/api-test/README.md](../scripts/api-test/README.md#watching-the-distributed-part-happen-live).

## What "fully working" looks like, end to end

If you've run 00 → 13 in order (or `./run-all.sh`) with all 8 terminals
up, you should be able to say all of the following are true:

- Every service in 00 answered `2xx`.
- A customer and an approved, available driver both exist (01, 02, 06,
  07).
- A GPS ping landed on Kafka (08, provable via 16 or offset deltas).
- A ride request went `searching` → `accepted` with a real driver
  attached, having crossed core-api → Kafka → dispatch-service → Kafka
  → core-api with no direct service-to-service call (09–12).
- The atomicity guarantee on offer acceptance held under a real
  double-accept attempt (11's negative case, `409`).
- Cancellation's state-machine guard held under a real double-cancel
  attempt (13's negative case, `422`).

Anything short of that — compare against the specific "Expect" text
above for the step that didn't match; each one names the exact
condition (a missing terminal, a timing issue, an actual bug) that
would produce a different result.
