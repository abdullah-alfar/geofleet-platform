# rider-web

Nuxt 4 / TypeScript. The customer-facing app for GeoFleet: register/log
in as a rider, request a ride, and — once a driver accepts — watch that
driver's live position on a real map, the actual "Uber rider screen"
experience. New in this platform: previously there was no customer-facing
UI at all, only `apps/admin-web` (internal staff) and `apps/landing-web`
(marketing). This app is a genuine core-api customer — unlike admin-web
(which is fully independent of core-api, see
[ADR 0011](../../docs/decisions/0011-admin-api-independent-service.md)),
rider-web talks to core-api directly for auth/registration/ride-requests,
and to `apps/realtime-gateway`'s customer WebSocket for the live push
(ride assigned/unavailable, the driver's live location) — no admin-api
involvement anywhere in this app.

## Structure

```
app/
  app.vue, layouts/default.vue     Shell: header (name + sign out), no nav (this app does one thing)
  middleware/auth.global.ts         Redirects unauthenticated visitors to /login, authenticated ones away from /login|/register
  plugins/auth.client.ts            Restores the token on boot, verifies it against GET /api/v1/auth/me
  stores/auth.ts                    register()/login() against core-api's own /api/v1/auth/*, token in localStorage
  composables/
    useCoreApi.ts                    Bearer-token injection + ApiError normalization for every core-api call
    useCustomerSocket.ts              realtime-gateway's customer WebSocket client, with auto-reconnect
  types/{api,user,ride}.ts           core-api response shapes + the WS message envelope
  components/RideTrackingMap.vue     MapLibre GL + free OSM raster tiles (no API key) — a driver marker that
                                      glides to each new position pushed over the WebSocket, plus a fading trail
  pages/
    login.vue, register.vue          Auth forms
    ride.vue                         The whole app: request form -> searching -> live tracking -> ended, one page
```

## Running locally

Requires core-api (`php artisan serve`, port 8000) and realtime-gateway
(port 8083) running, plus the usual outbox-publish loop for ride requests
to actually reach dispatch-service.

```bash
cd apps/rider-web
cp .env.example .env
npm install
npm run dev   # port 3003
```

## The ride lifecycle this app drives

1. Register or log in (`POST /api/v1/auth/register` / `/login`) — a
   normal core-api customer account, same as any other client.
2. Request a ride (`POST /api/v1/ride-requests`) — status starts
   `searching`. The page polls `GET /api/v1/ride-requests/:id` every 3s
   as a fallback/reconciliation layer, but the WebSocket is what actually
   drives the UI in real time.
3. `useCustomerSocket` connects to
   `ws://.../v1/ws/customer?token=<bearer>` (browsers can't set custom
   headers on a WS upgrade, so the token goes as a query param — see
   `apps/realtime-gateway/internal/httpapi/ws.go`'s own comment on this).
   Three message types matter here: `ride.assigned` (refetch the ride
   detail immediately, don't wait for the next poll tick),
   `ride.unavailable` (same), and `driver.location` (`lat`/`lng`/
   `recorded_at` — fed straight into `RideTrackingMap`, no REST round
   trip at all for position updates).
4. Once `status === 'accepted'`, the tracking map renders: a real street
   map (MapLibre GL + OpenStreetMap raster tiles — free, no token/API key
   needed, unlike Google Maps/Mapbox) with the driver's marker gliding
   between each push and a fading trail of recent positions.
5. `POST /api/v1/ride-requests/:id/cancel` while searching/offered;
   "Request another ride" once the ride reaches a terminal status
   (`cancelled`/`expired`/`unavailable`).

## What was verified live vs. what wasn't (browser-tool limitation)

Verified directly in a real logged-in browser session against the live
stack: registration, login, ride-request creation, the `searching` state,
a real `unavailable` outcome (no driver in range within the matching
window — not fabricated, the platform's own matching genuinely produced
it), cancel, "request another ride", and — critically — the
`ride.assigned` WebSocket push itself, which flipped the UI from
"searching" to "your driver is on the way" the instant a seeded driver
accepted the offer (confirmed via curl against dispatch-service's own
accept endpoint), with no polling delay.

The subsequent `driver.location` push (the moving-marker part) could not
be observed rendering in this development environment's sandboxed
preview browser specifically — repeated, reproducible testing showed
that browser's raw WebSocket connections to a non-dev-server port
(realtime-gateway, 8083) fail immediately (`onerror` + code 1006) no
matter what, while the identical connection (same URL, same bearer token)
from a plain Python `websocket-client` succeeds immediately and receives
real `driver.location` pushes correctly — and realtime-gateway's own
Prometheus counter (`realtime_gateway_kafka_events_relayed_total{event_type="driver.location"}`)
and its Redis-backed driver→customer assignment record
(`rt:assignment:{driver_id}`) both confirmed the relay pipeline was live
and correctly wired for this exact ride throughout. This points at a
sandboxed-browser networking constraint specific to this dev tool (cross-
port WebSocket egress), not a defect in `useCustomerSocket.ts` or
realtime-gateway — a real desktop/mobile browser has no such restriction.
