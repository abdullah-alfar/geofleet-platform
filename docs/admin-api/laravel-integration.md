# admin-api: Laravel command integration (Phase 6)

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

Four commands exist today, one per the abilities `AdminPermissions`
already defines (`docs/admin-api/permissions.md`):

| admin-api route | permission | core-api route | Effect |
|---|---|---|---|
| `POST /drivers/:id/approve` | `drivers.approve` | `PATCH /internal/v1/drivers/{id}/approve` | `drivers.status = 'active'` (only from `pending_review`) |
| `POST /drivers/:id/suspend` | `drivers.suspend` | `PATCH /internal/v1/drivers/{id}/suspend` | `drivers.status = 'suspended'`, `is_available = false` |
| `POST /trips/:id/cancel` | `trips.cancel` | `PATCH /internal/v1/trips/{id}/cancel` | `trips.status = 'cancelled'` (only from `in_progress`) |
| `POST /payments/:id/refund` | `payments.refund` | `PATCH /internal/v1/payments/{id}/refund` | `payments.status = 'refunded'` (only from `completed`) |

`drivers.approve` closes a gap that existed since the original 8-phase
plan: nothing anywhere in this platform ever moved a driver out of
`pending_review` (the default status every registration creates —
`database/migrations/2026_08_06_100020_create_drivers_table.php`) until
this command existed. No Kafka event fires for it — same reasoning as
`payments.refund` below: `driver.status.changed.v1`'s only real payload is
`{driver_id, is_available}`, and approval doesn't change `is_available`
(the driver still has to explicitly go online themselves), so there's
nothing this event would honestly carry.

## Why core-api's response is passed straight through

admin-api does not re-shape `DriverResource`/`TripResource`/
`PaymentResource` into its own DTO — core-api's domain logic is the
source of truth for what a driver/trip/payment looks like after a
mutation, and admin-api has no independent read of that same row (its own
projections are Kafka-derived and eventually consistent, not
transactionally coupled to this write). Duplicating the shape here would
mean two places that could drift; instead `CoreApiClientService.patch<T>()`
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

- **Approve publishes nothing.** `driver.status.changed.v1`'s only real
  payload is `{driver_id, is_available}` (see
  [kafka-projections.md](kafka-projections.md)) — approval changes
  `drivers.status`, not `is_available` (the driver still has to
  explicitly go online themselves via `PATCH /api/v1/driver/availability`
  once approved), so there's nothing this event would honestly carry. No
  topic exists for a general driver-status change either — same "don't
  force data into an event that doesn't fit" reasoning as
  `payment.refunded.v1` below.
- **`driver.status.changed.v1`** — suspend reuses the *existing* live
  topic (same one `PATCH /api/v1/driver/availability` already publishes
  to), with `is_available: false`. This is why the suspended-driver's
  effect is immediate rather than eventually-consistent-on-next-poll:
  dispatch-service's Redis candidate index already consumes this exact
  topic and drops the driver from matching as soon as the message lands —
  no new consumer needed.
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
