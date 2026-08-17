# api-test — a terminal-native Postman replacement, built to read code alongside

A Postman collection already exists
([contracts/postman/](../../contracts/postman/)), but Postman lives outside
your terminal and doesn't tell you which source file handles a request.
This does both: plain `curl` + `jq`, one small script per request, each
one printing the source file/method it's about to exercise before it
fires — so you run the script, then go read that file.

No extra tools to install — just `curl`, `jq`, `bash`, and (only for
15) the `websocket-client` Python package.

New here? [docs/developer-test-flow.md](../../docs/developer-test-flow.md)
walks through every script below in order, from a cold environment,
stating exactly what to expect at each step (including which failures
are actually expected negative-test behavior, not bugs).

## Quick start

```bash
cd scripts/api-test
./run-all.sh
```

Runs the whole happy-path ride lifecycle — register a customer and a
driver, add a vehicle, register a GPS device, get the driver approved,
go available, submit a GPS ping, request a ride, watch dispatch-service
match it, accept the offer, verify the ride shows as accepted — chaining
core-api, location-service, and dispatch-service into one real,
distributed-system round trip.

Requires those three services running (`php artisan serve`,
`go run ./cmd/location-service`, `go run ./cmd/dispatch-service`), plus
core-api's `watch -n 2 php artisan outbox:publish` loop — nothing here
reaches Kafka without that. See
[docs/local-development-without-docker.md](../../docs/local-development-without-docker.md)
if none of that is running yet.

## Or run one script at a time

Every script is independently runnable and safe to re-run (they save
what they produce into `.state`, a plain `KEY=value` file next to this
README — `git`-ignored, delete it any time to start fresh). This is the
actual point of the kit: open the file each script's `step` banner names,
run the script, read the response next to the code that produced it.

| Script | What it hits | Read alongside |
|---|---|---|
| `00-health-check.sh` | every service's `/health` | — |
| `01-register-customer.sh` | `POST /auth/register` | `AuthController::register` |
| `02-register-driver.sh` | `POST /auth/register` (driver) | same, + `drivers` migration's status default |
| `03-login.sh` | `POST /auth/login` (+ 2 negative cases) | `AuthController::login` |
| `04-add-vehicle.sh` | `POST /drivers/vehicles` | `VehicleController::store` |
| `05-register-device.sh` | `POST /driver/devices` | `DriverDeviceController::store` |
| `06-admin-approve-driver.sh` | `PATCH internal/v1/drivers/{id}/approve` | `DriverCommandController::approve`, ADR 0010 |
| `07-go-available.sh` | `PATCH /driver/availability` | `DriverAvailabilityController::update` |
| `08-submit-gps.sh` | location-service `POST /v1/locations` | `internal/httpapi/location_handler.go` |
| `09-create-ride-request.sh` | `POST /ride-requests` | `RideRequestController::store` |
| `10-check-offers.sh` | dispatch-service `GET /v1/ride-offers/pending` | `internal/httpapi/offer_handlers.go` |
| `11-accept-offer.sh` | dispatch-service `POST /v1/ride-offers/{id}/accept` (+ negative case) | `internal/offers/service.go::Accept` |
| `12-verify-ride-assigned.sh` | `GET /ride-requests/{id}`, `GET /trips` | `RideRequestController::show` |
| `13-cancel-ride-request.sh` | `POST /ride-requests/{id}/cancel` (+ 2 negative cases) | `RideRequestController::cancel` |
| `14-admin-api-session.sh` | admin-api session + drivers list (+ negative case) | `docs/admin-api/query-apis.md` |
| `15-realtime-ws.py` | realtime-gateway WebSocket, live | `internal/httpapi/ws.go`, `internal/relay/*.go` |
| `16-tail-kafka.sh` | every topic in `docs/events/topic-catalog.md`, live | the raw envelopes themselves — no single source file, this is the wire format every publisher/consumer above agrees on |

Scripts 04–13 depend on state from earlier ones (`require` at the top of
each one tells you exactly which variable is missing and which script
sets it, if you jump in out of order).

## Watching the distributed part happen live

Two terminals side by side is the actual point of this kit:

```bash
# Terminal A
./15-realtime-ws.py

# Terminal B — after 01/02 have run so CUSTOMER_TOKEN exists
./09-create-ride-request.sh
./10-check-offers.sh
./11-accept-offer.sh
```

Terminal A prints `ride.assigned.v1` the instant dispatch-service
publishes it — no polling, no refresh, the same push a real rider app
gets.

`16-tail-kafka.sh` is the lower-level version of the same idea — instead
of one relayed WebSocket feed, it's every raw event envelope on every
topic, straight from Kafka:

```bash
./16-tail-kafka.sh                    # all topics, new messages only
./16-tail-kafka.sh --from-beginning   # all topics, replay everything retained
./16-tail-kafka.sh ride.requested.v1  # just one topic
```

**Known gap: the first second or two after starting can miss messages.**
Consumer groups don't subscribe instantly — `kafka-console-consumer.sh`
has to join the group and get a partition assignment from the broker
before it actually starts receiving, and that join/rebalance takes a
brief moment. If you start this script and immediately fire off a script
like `08-submit-gps.sh` in the same breath, the publish can land before
the join finishes and never show up here. This is normal Kafka consumer
behavior, not a bug in this script. Two ways around it:
- Use `--from-beginning` — replays retained history, so nothing is
  missed regardless of join timing.
- Just pause a beat after the "Tailing ... (Ctrl+C to stop)" banner
  prints before triggering the event you want to watch for.

## Testing failure cases, not just the happy path

Several scripts include a negative case right after the real request —
wrong password, double-accepting the same offer, cancelling an
already-cancelled ride, calling an authenticated endpoint with no token.
Each one prints which specific line of code produces that error, since
"the API returned 409" is a lot less useful than "the atomic UPDATE in
`offerstore.go` affected 0 rows, so this IS the concurrency guarantee
working." If you want more of these, the pattern is: pick a controller
method, look at every `abort()`/thrown exception/`errors.Is()` branch in
it, and write one curl call that hits each one — that's genuinely the
fastest way to understand a codebase's actual behavior, not just its
happy path.

## What this kit can't reach (yet)

Nothing in core-api consumes `ride.assigned.v1` to create a `trips` row —
so the ride lifecycle these scripts can exercise stops at `status:
accepted` on the ride request. Trip start/complete and payments aren't
wired end-to-end anywhere in this repo yet (see the note in
`docs/events/topic-catalog.md` on `trip.location.updated.v1`). `12-verify-ride-assigned.sh`
calls `GET /trips` anyway and explains the empty result — it's a real
platform gap, not something wrong with this kit.
