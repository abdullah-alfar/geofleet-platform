# admin-web

Nuxt 4 / TypeScript / Tailwind. The browser-based admin panel for the
GeoFleet platform — calls [apps/admin-api](../admin-api) for everything
except login, which goes through core-api directly (admins share the same
`/api/v1/auth/login` endpoint as customers/drivers — see
[ADR 0009](../../docs/decisions/0009-admin-identity.md)).

This is additive scope, not part of admin-api's own 8-phase plan
([docs/admin-api/overview.md](../../docs/admin-api/overview.md)) — it's the
"Admin Web" box that plan's own architecture diagram always drew as
out-of-scope, now built.

## Why SPA mode, not SSR

`ssr: false` in `nuxt.config.ts`. This is an internal, authenticated-only
tool with no public pages and no SEO need — SSR would only add complexity
(forwarding bearer tokens server-side, hydration mismatches on auth-gated
content) for a benefit this app doesn't need.

## Structure

```
app/
  app.vue                    NuxtLayout + NuxtPage
  layouts/default.vue        Nav shell — only lists links to pages that exist, filtered by the admin's actual abilities
  pages/
    login.vue                 No layout — calls the auth store's login(), which hits core-api then verifies against admin-api's /session
    index.vue                 Redirects to /dashboard
    dashboard.vue              GET /dashboard/summary + /dashboard/regions
    drivers/index.vue          GET /drivers, filtered + cursor-paginated
    drivers/[id].vue           GET /drivers/:id + approve/suspend/unsuspend/disable commands
    customers/index.vue        GET /customers, filtered + cursor-paginated
    customers/[id].vue         GET /customers/:id (+ total_rides/total_trips) — read-only, no commands
    rides/index.vue            GET /rides, filtered + cursor-paginated
    rides/[id].vue             GET /rides/:id (+ timeline) + GET /rides/:id/offers
    trips/index.vue            GET /trips, filtered + cursor-paginated
    trips/[id].vue             GET /trips/:id (+ timeline) + cancel command
    payments/index.vue         GET /payments, filtered + cursor-paginated
    payments/[id].vue          GET /payments/:id + refund command
    realtime.vue                Live driver map (SVG scatter, no map SDK), live counters, incident feed — polled, not pushed
    admins/index.vue            GET /admins + role-change/deactivate — super_admin-only, hides controls for the caller's own row
  components/
    CommandButton.vue          Shared "click -> optional reason -> confirm" pattern for suspend/cancel/refund/etc.
    DriverMap.vue               Auto-fit SVG scatter plot of live driver positions
  composables/
    useAdminApi.ts              The only place any call to admin-api is made — base URL, bearer token, error normalization, global 401 handling
    usePaginatedList.ts          Wraps a cursor-paginated GET — reactive query, refresh()/loadMore(), never an OFFSET
    useAdminCommand.ts           Wraps a POST command endpoint — pending/error state; run() for {reason}-only bodies, runWithBody() for extras (e.g. admin_role)
  stores/auth.ts                Pinia — token (persisted to localStorage), admin identity (re-derived from /session on every boot, never persisted)
  middleware/auth.global.ts     Redirects unauthenticated requests to /login, authenticated requests away from /login
  plugins/auth.client.ts        Restores the token and verifies it against /session before the app mounts
  types/                        Hand-mirrored copies of admin-api's own response shapes (api.ts, driver.ts, ride.ts, trip.ts, payment.ts, realtime.ts, dashboard.ts, admin-account.ts)
```

## Running locally

Requires core-api and admin-api both running (see their own READMEs).

```bash
cd apps/admin-web
cp .env.example .env   # points at admin-api:3001 and core-api:8000 by default
npm install
npm run dev
```

Open http://localhost:3000. admin-api's `ADMIN_WEB_ORIGINS` must include
this origin (`.env.example` already sets it to `http://localhost:3000`) or
every request will fail CORS.

## Auth flow

```
Login page -> POST core-api /api/v1/auth/login (email/password)
  -> reject if response.data.role !== 'admin'
  -> store the returned Sanctum token
  -> GET admin-api /api/v1/admin/session (verifies the token actually
     works against admin-api, populates adminRole/abilities)
  -> navigate to /dashboard
```

`auth.hasAbility(ability)` gates every nav link and command button — the
same abilities admin-api's own `PermissionsGuard` enforces server-side.
Client-side hiding is a UX nicety, not the security boundary; a hidden
button doesn't mean the server would have allowed the request anyway.

## Command actions read their own result live

Suspend/cancel/refund/approve/etc. all POST through admin-api to
core-api (see [laravel-integration.md](../../docs/admin-api/laravel-integration.md)).
The response used for the success message is core-api's own resource
shape; the list/detail views the page re-fetches afterward call
admin-api's own GET endpoints, which now read live from core-api too
(see [query-apis.md](../../docs/admin-api/query-apis.md)) — no Kafka
projection in between, so there's no eventual-consistency lag between
the command's response and the page's own refresh.

## What's not built

- No realtime *push* — the live map/counters/incidents page polls on a
  timer (staying comfortably under admin-api's per-route throttle limits),
  it doesn't hold a WebSocket open. admin-api itself has no push
  mechanism to subscribe to (REST endpoints only, not a gateway).
- `DriverMap.vue` is a plain auto-fit SVG scatter plot, not a real
  street map — no tile server, no mapping SDK dependency for this first
  pass. Upgrade path exists if real geographic context becomes a real
  need.
- No audit-log viewer — `audit_logs` (core-api, Postgres) has no admin-web
  page reading it yet, only the command endpoints that write to it.
