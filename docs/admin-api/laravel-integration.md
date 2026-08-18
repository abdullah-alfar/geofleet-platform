# admin-api: Laravel command integration (Phase 6)

**Superseded by [ADR 0011](../decisions/0011-admin-api-independent-service.md).**
This entire document describes the Phase 6 design — admin-api forwarding
commands to core-api's `internal/v1` API over HTTP, authenticated by the
shared secret [ADR 0010](../decisions/0010-internal-service-authentication.md)
describes. That call path no longer exists: admin-api now writes
directly to Postgres for every command (guard, outbox insert, audit
insert, all in one transaction — see each module's `*.service.ts`,
e.g. `drivers.service.ts`). Kept as historical record, not deleted, per
this doc set's own convention — read everything below as describing the
*old* mechanism.

How an admin action (suspend a driver, cancel a trip, refund a payment)
gets from a click in admin-web to a real Postgres write and — where a
topic exists for it — a Kafka event, without admin-api ever touching
core-api's domain tables. See the critical architecture rule in
[overview.md](overview.md) and
[ADR 0010](../decisions/0010-internal-service-authentication.md) for the
service-to-service auth this relies on.

## The chain

```
Admin Web
  -> POST /api/v1/admin/drivers/{id}/suspend   (Authorization: Bearer <sanctum token>)
  -> AuthGuard + PermissionsGuard(drivers.suspend)   [admin-api, Phase 2]
  -> DriversService.suspend()
       -> CoreApiClientService.patch()
            -> PATCH {CORE_API_BASE_URL}/api/internal/v1/drivers/{id}/suspend
                 X-Internal-Service-Token: <shared secret>
                 X-Correlation-Id: <propagated from the inbound request>
                 { admin_user_id, reason }
  -> App\Http\Middleware\VerifyInternalServiceToken   [core-api]
  -> App\Http\Controllers\Api\Internal\V1\DriverCommandController::suspend
       -> conditional atomic UPDATE drivers SET status = 'suspended', ...
       -> Outbox::record('driver.status.changed', ...)   [reuses the
          existing live topic — see "Kafka events" below]
       -> AdminAudit::record(...)   -> audit_logs
  -> DriverResource   (core-api's own JSON shape, passed straight through)
  -> { data: {...} }   [admin-api's response envelope]
```

Six commands exist today, one per the abilities `AdminPermissions`
already defines (`docs/admin-api/permissions.md`):

| admin-api route | permission | core-api route | Effect |
|---|---|---|---|
| `POST /drivers/:id/approve` | `drivers.approve` | `PATCH /internal/v1/drivers/{id}/approve` | `drivers.status = 'active'` (only from `pending_review`) |
| `POST /drivers/:id/suspend` | `drivers.suspend` | `PATCH /internal/v1/drivers/{id}/suspend` | `drivers.status = 'suspended'`, `is_available = false` |
| `POST /drivers/:id/unsuspend` | `drivers.unsuspend` | `PATCH /internal/v1/drivers/{id}/unsuspend` | `drivers.status = 'active'` (only from `suspended`) |
| `POST /drivers/:id/disable` | `drivers.disable` | `PATCH /internal/v1/drivers/{id}/disable` | `drivers.status = 'disabled'`, `is_available = false` (from any non-`disabled` status) |
| `POST /trips/:id/cancel` | `trips.cancel` | `PATCH /internal/v1/trips/{id}/cancel` | `trips.status = 'cancelled'` (only from `in_progress`) |
| `POST /payments/:id/refund` | `payments.refund` | `PATCH /internal/v1/payments/{id}/refund` | `payments.status = 'refunded'` (only from `completed`) |

`unsuspend` and `disable` fill out the rest of `drivers.status`'s state
machine alongside `approve`/`suspend`: `unsuspend` is strict (only from
`suspended`, matching `approve`'s reasoning — a caller error shouldn't be
silently absorbed) and deliberately does **not** accept a `disabled`
driver back to `active` — disable is meant to read as a harder,
more-permanent stop than suspend, and letting unsuspend reverse it would
erase that distinction. `disable` is idempotent like `suspend` (same
`setInactiveStatus()` helper in `DriverCommandController` — "ensure this
driver is suspended/disabled" is the actual intent of either, not
"transition from exactly one prior state"). Neither has a reverse for
`disable` itself — not asked for.

`drivers.approve` closes a gap that existed since the original 8-phase
plan: nothing anywhere in this platform ever moved a driver out of
`pending_review` (the default status every registration creates —
`database/migrations/2026_08_06_100020_create_drivers_table.php`) until
this command existed. All four driver-status commands publish
`driver.status.changed.v1` — see "Kafka events" below for what changed
there and why (a real gap caught live, not designed in from the start).

## Why core-api's response is passed straight through

admin-api does not re-shape `DriverResource`/`TripResource`/
`PaymentResource` into its own DTO — core-api's domain logic is the
source of truth for what a driver/trip/payment looks like after a
mutation, and admin-api keeps no independent copy of that row at all
(no more Kafka-projected `admin_read` schema — see
[query-apis.md](query-apis.md)). Duplicating the shape here would mean
two places that could drift; instead `CoreApiClientService.patch<T>()`
returns core-api's JSON body verbatim, wrapped only by admin-api's own
`{ data: ... }` envelope.

## Error propagation

`CoreApiClientService` reshapes core-api's `{ error: { code, message } }`
into the `{ message, code }` body `AllExceptionsFilter` already knows how
to render (`src/common/filters/all-exceptions.filter.ts`) — so a core-api
`409 conflict` ("Trip cannot be cancelled from its current status") or
`404 driver_not_found` surfaces to admin-web as admin-api's own error with
the same code and status, not a generic `core_api_error` wrapper. Only a
genuinely unreachable core-api (network error, timeout) produces a new
code — `503 core_api_unavailable` — since there's nothing from core-api to
pass through in that case.

## Admin account management

A different shape of "command" — managing who else can operate the admin
panel, not a ride-hailing domain entity:

| admin-api route | permission | core-api route | Effect |
|---|---|---|---|
| `GET /admins` | `admins.view` | `GET /internal/v1/admins` | Lists admin accounts |
| `PATCH /admins/:id/role` | `admins.manage` | `PATCH /internal/v1/admins/{id}/role` | `admins.admin_role = <new role>` |
| `PATCH /admins/:id/deactivate` | `admins.manage` | `PATCH /internal/v1/admins/{id}/deactivate` | `users.status = 'disabled'` (from any non-`disabled` status) |

Three things distinguish this from every other command in this doc:

- **The first read that goes through `internal/v1/*`.** Admin accounts
  live in core-api's `public` schema (`users`/`admins`), which admin-api
  only ever reads through its narrow auth-verification grant (three
  columns across three tables — see
  [authentication.md](authentication.md)) — nowhere near enough to serve
  a list. Rather than widening that grant or inventing a Kafka
  projection for a handful of platform-security-config rows with no need
  for eventual consistency, `GET /internal/v1/admins` reuses the same
  shared-secret boundary the commands already use —
  [ADR 0010](../decisions/0010-internal-service-authentication.md) scopes
  `internal/v1` as "service-to-service, no end user," not "mutations
  only." `CoreApiClientService` gained a `.get<T>()` method for this
  (`src/integrations/core-api/core-api-client.service.ts`) — the same
  error-normalization logic `.patch<T>()` already had, factored out.
- **`admins.view`/`admins.manage` are super_admin-only in practice** —
  neither string appears in any other role's ability array
  (`App\Support\AdminPermissions`); only `super_admin`'s own `'*'`
  wildcard satisfies the check. Managing who else can operate the admin
  panel is inherently the platform's highest-privilege concern.
- **Self-protection**: `AdminAccountController::updateRole()`/
  `::deactivate()` both reject (`422`) if the target account is the
  caller's own — guards the realistic failure mode of an admin
  fat-fingering their own row in a list UI and locking themselves (and
  potentially everyone, if they're the only super_admin) out with no one
  else around to fix it. admin-web hides the controls for the caller's
  own row rather than surfacing that error, but the real boundary is
  server-side.

A real bug this caught before shipping: `AdminAccountResource.id` is the
`admins` table's own uuid, but `AdminPrincipal.userId` (what `/session`
returns for the caller's own identity) is the underlying `users.uuid` —
two different uuids for the same person. admin-web's "is this row me"
check needs to compare against the *user's* uuid, not the admin row's —
comparing against `id` would have silently never matched. Fixed by
exposing a second field, `user_id`, on `AdminAccountResource` and
threading it through admin-api's `AdminAccountRow` type to admin-web.
Provisioning a **new** admin still stays `php artisan admin:create` only
(ADR 0009) — this only manages accounts that already exist.

## Idempotency and conflict semantics

- **Suspend** is idempotent: suspending an already-suspended driver
  returns `200` with the current (unchanged) state, not an error — the
  desired end-state is already true. No duplicate audit row or Kafka
  event fires for the no-op case.
- **Approve**, **cancel**, and **refund** are not idempotent in the same
  way — each only succeeds from one specific starting status
  (`pending_review` / `in_progress` / `completed`); a repeat call gets
  `409 conflict`, since "approve a driver who's already active," "cancel
  a trip that's already cancelled," and "refund a payment that's already
  refunded" are meaningfully different requests, not safe retries of the
  same one. Approve is deliberately strict rather than idempotent like
  suspend: re-approving an already-active driver isn't a meaningful
  "ensure approved" no-op — it's a caller/UI error (e.g. a double-click)
  that should surface, not be silently absorbed.

All four commands use the same conditional-atomic-UPDATE pattern already
established by `RideRequestController::cancel` and dispatch-service's
offer-acceptance transaction (see AGENTS.md) — `UPDATE ... WHERE status =
X`, check the affected-row count, never a read-then-write race.

## Who gets attributed

Each command body carries `admin_user_id` — `AdminPrincipal.userId`
(`users.uuid`), the same identity admin-api's own `AuthGuard` already
verified for this exact request. core-api validates it resolves to a real
`role = 'admin'` user (defense in depth, not a second permission check —
see ADR 0010) and writes it to `audit_logs.actor_id` via
`App\Domain\Audit\AdminAudit::record()`. This is the first thing in this
platform that ever writes to `audit_logs` — the table existed since the
original 8-phase plan but had no writer until now.

## Kafka events: only where a topic already exists

- **`driver.status.changed.v1`** — all four driver commands
  (approve/suspend/unsuspend/disable) publish through one shared
  `DriverCommandController::publishStatusChanged()` helper, reusing the
  *existing* live topic (the same one `PATCH /api/v1/driver/availability`
  already publishes to). This wasn't the original design: approve/
  unsuspend originally published nothing at all, on the reasoning that
  neither actually changes `is_available` (a driver still has to
  explicitly go online themselves) — true as far as it went, but it
  missed that `admin_driver_projection.status` has no *other* source.
  The result: an admin could approve or suspend a driver through the
  panel, and the panel's own list view would show the change for
  `suspend`/`disable` (which already fired the event, just without
  `status`) but never, ever, for `approve`/`unsuspend` — not even
  eventually. Caught by inspecting a real screenshot of the drivers list
  (every row's `Status` column showed `—`, including ones just
  approved/suspended live) and confirmed by re-reading
  `driver-status-changed.handler.ts` — it only ever wrote
  `availability_status`, never `status`. Fixed on both ends: the event's
  `data` payload gained an optional `status` field, and the projection
  handler writes it *only* when present, so a plain availability toggle
  (which never includes `status`) can't clobber an admin-set value back
  to `NULL`. Verified live: approved a fresh driver, confirmed `status:
  "active"` landed in `admin_driver_projection` and in
  `GET /api/v1/admin/drivers/{id}`'s response; then toggled that same
  driver's own availability and confirmed `status` survived unchanged.
  Backward compatible — dispatch-service's own consumer
  (`encoding/json`, unknown-field-tolerant by default) already ignores
  fields it doesn't declare in its struct, confirmed by reading its
  `DriverStatusChanged` type before making the change. This is also why
  a suspended/disabled driver's removal from dispatch-service's matching
  pool is immediate rather than eventually-consistent-on-next-poll:
  dispatch-service's Redis candidate index already consumes this exact
  topic and drops the driver from matching as soon as the message lands —
  no new consumer needed, for any of the four commands. The consumer
  that originally motivated adding `status` to this payload
  (admin-api's own `admin_driver_projection` handler) no longer exists —
  see [query-apis.md](query-apis.md) — but the field stays: it's a more
  complete description of what actually changed, dispatch-service's
  consumer already tolerates it, and admin-web now sees a driver's
  `status` via a live `GET /internal/v1/drivers/{id}` read instead of
  waiting on this event either way.
- **`trip.cancelled.v1`** — the topic catalog reserved this topic in
  Phase 1 but it never had a producer. Admin-forced cancellation is now
  the first live producer for it — see
  [docs/events/topic-catalog.md](../events/topic-catalog.md). No consumer
  exists yet (realtime-gateway's is still "planned"), but every admin
  cancellation from this point on is captured on the topic for whenever
  one is built.
- **`payment.refunded.v1`** does not exist and refund does not publish
  anything to Kafka. The topic catalog only reserves
  `payment.requested/completed/failed.v1`; Kafka auto-topic-creation is
  disabled cluster-wide, so publishing to an unreserved topic would fail
  outright. Adding a new topic is platform infrastructure
  (`infrastructure/kafka/init-topics.sh`, Phase 1 scope) — not something
  to introduce as a side effect of one admin command in an explicitly
  additive phase. The refund is still fully durable via `payments.status`
  and `audit_logs`; a future need for other services to react to refunds
  in real time is the trigger to add the topic, not before.

## A real gap this closes: a suspended driver could otherwise un-suspend themselves

`PATCH /api/v1/driver/availability` (the driver's own toggle) previously
had no awareness of `drivers.status` at all — any authenticated driver
could set `is_available = true` regardless of standing. Suspension would
have been cosmetic without a guard: `App\Http\Controllers\Api\V1\DriverAvailabilityController::update`
now rejects `is_available: true` with `403` when `drivers.status ===
'suspended'`. Scoped narrowly (only the `suspended` status is checked) —
every driver in this platform is currently `pending_review` by default
(nothing transitions drivers into `active` yet, a pre-existing gap outside
this phase's scope), so this guard changes behavior only for the new
`suspended` status this phase introduces, not for any existing account.

## What today's live verification could and couldn't exercise

Every command was verified against **real** Postgres writes, a **real**
Kafka topic (`trip.cancelled.v1` consumed directly off the broker after
an admin cancellation, confirming the exact payload), and **real**
permission enforcement (an `operations_admin` token succeeding on
suspend/cancel and a `finance_admin` token correctly getting `403` on
both; the reverse for refund). What it could not exercise against
organic data: `trips` and `payments` rows are never created by any
existing flow in this platform (no consumer creates a `trips` row from
`ride.assigned.v1` — see ADR 0006 and the topic catalog's own note on
`trip.location.updated.v1`) — the same honest gap Phase 4/5 already
documented for the trip/payment projections being permanently empty. The
trip and payment cancelled/refunded in this phase's live verification
were manually seeded rows (`Trip::forceCreate()`/`Payment::forceCreate()`
— both models have no `#[Fillable]` since nothing in the real application
ever constructs one via mass assignment), deleted afterward. The commands
themselves are fully correct and will operate on real rows the moment
core-api's trip-creation gap closes.

## A real bug caught while retiring the Kafka read model

Every command controller (`DriverCommandController`, `TripCommandController`,
`PaymentCommandController`, `AdminAccountController`) returned a bare
`new XResource(...)` — Laravel's `JsonResource` wraps a single-resource
response in `{"data": {...}}` by default (`JsonResource::$wrap = 'data'`),
so core-api's actual response to every command was `{"data": {"id":...,
"status":...}}`, not the flat object this doc's own chain diagram above
shows. `CoreApiClientService.patch<T>()` returns that body verbatim, then
admin-api's own response interceptor wraps it *again* in its own
`{ data: ... }` envelope — the real, shipped response to admin-web was
`{"data": {"data": {"id":..., "status":...}}}`, double-nested.
admin-web's own success-message code (`result.status` in
drivers/trips/payments' `[id].vue`) had been silently printing
`undefined` since Phase 6 as a result — never thrown, never failed any
prior live-verification pass, because those checked core-api's own
database state and HTTP status codes, not the literal rendered success
message text. Caught only by directly `curl`-ing an internal/v1 command
endpoint and reading the actual response body while verifying the new
query endpoints ([query-apis.md](query-apis.md)) return unwrapped
`DriverRow` shapes as documented. Fixed by returning
`(new XResource(...))->resolve()` — the resolved array, not the Resource
object — from every command controller; `->resolve()` bypasses the
wrap-check entirely. Re-verified live: `PATCH .../unsuspend` now returns
a flat `{"id":..., "status":"active", ...}`.

## A real bug this live verification caught

`App\Models\AuditLog` had no `#[Fillable]` attribute — the model existed
since the original 8-phase plan's `audit_logs` migration, but nothing had
ever written to it via `Model::create()` until `AdminAudit::record()`
became the first caller, at which point every command failed with a
`500 server_error` ("Add [actor_type] to fillable property..."). Fixed by
declaring `#[Fillable([...])]` on `AuditLog`, matching every other
writable model in this codebase (`Driver`, `User`, `Vehicle`,
`RideRequest`); re-verified live afterward — all three commands succeed
and their audit rows are readable directly from Postgres with the correct
actor, action, and change payload.
