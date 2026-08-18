# driver-web

Nuxt 4 / TypeScript. The driver-facing companion to `apps/rider-web`:
register/log in as a driver, add a vehicle, go online, and accept or
reject ride offers as they arrive — the driver side of the same
end-to-end flow `apps/rider-web` demonstrates from the rider's side.
Talks to core-api (auth, vehicle/device registration, availability),
dispatch-service (offer accept/reject/pending), location-service (GPS
pings), and realtime-gateway's driver WebSocket (real-time offer push) —
no admin-api involvement, same as rider-web.

## Structure

```
app/
  stores/
    auth.ts         Sanctum user token (register/login/refresh) — core-api calls
    device.ts        The separate device token (see below), persisted independently
  composables/
    useCoreApi.ts           Bearer = Sanctum user token
    useDeviceApi.ts          Bearer = device token, for dispatch-service/location-service
    useDriverSocket.ts        realtime-gateway's driver WebSocket (device token)
    useGpsPing.ts              One GPS fix to location-service
  utils/deviceIdentifier.ts   Stable per-browser device_identifier (survives retries)
  components/OfferInbox.vue   WS push + poll fallback, Accept/Reject, expiry countdown
  pages/
    login.vue, register.vue    Auth forms (register asks for license_number/license_expires_at)
    drive.vue                   The whole app: device setup -> vehicle setup -> online toggle -> GPS + offers
```

## Two separate credentials

Same convention as the rest of this platform (see AGENTS.md): the
Sanctum **user token** (from login) authenticates core-api calls made
*as this driver's account* — vehicles, devices, availability. The
**device token** (from `POST /api/v1/driver/devices`, minted once and
shown only in that response) is what dispatch-service, location-service,
and realtime-gateway's driver WebSocket all check instead — it
authenticates *this specific device*, not a logged-in session, matching
how a real driver phone works. `driver-web` registers a device
automatically on first visit (`app/utils/deviceIdentifier.ts` keeps the
identifier stable across retries) and stores both tokens separately in
localStorage.

## Running locally

Requires core-api (8000), dispatch-service (8082), location-service
(8081), and realtime-gateway (8083) running, plus the usual
outbox-publish loop.

```bash
cd apps/driver-web
cp .env.example .env
npm install
npm run dev   # port 3004
```

## The flow

1. Register (`role: 'driver'`, license number + expiry required) or log in.
2. Device auto-registers on first visit.
3. A new driver starts `pending_review` — going online is blocked until
   an admin approves them (`apps/admin-web`'s drivers page, or
   `php artisan admin:create` + the admin API's approve command). The
   vehicle form works regardless of status.
4. Add a vehicle (one active vehicle per driver, same rule core-api
   itself enforces).
5. Go online (`PATCH /api/v1/driver/availability`) — starts a GPS ping
   loop: browser geolocation if granted, otherwise the manual lat/lng
   fields shown on the page (prefilled to the same Amman point
   `apps/rider-web`'s ride form defaults to, so a demo rider and driver
   naturally land near each other), sent every 5s with a strictly
   increasing sequence/timestamp (location-service rejects anything
   else — see `internal/validation/validation.go`).
6. `OfferInbox` connects to realtime-gateway's driver WebSocket and shows
   any `ride.offer.created` push immediately (falls back to polling
   dispatch-service's `GET /v1/ride-offers/pending` every 5s in case the
   socket is mid-reconnect), with a live countdown to `expires_at`.
   Accept/Reject call dispatch-service directly with the device token.

## Not verified live this round

Built and typechecked (`npx vue-tsc --noEmit`, clean) but not exercised
in a browser — every endpoint, request/response shape, and validation
rule referenced above was read directly from the source it calls
(`App\Http\Requests\StoreDriverDeviceRequest`/`StoreVehicleRequest`/
`UpdateDriverAvailabilityRequest`, `internal/httpapi/offer_handlers.go`,
`internal/validation/validation.go`) rather than assumed.
