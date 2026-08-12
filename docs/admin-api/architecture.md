# admin-api: Architecture

## Target container view

```mermaid
C4Container
    title GeoFleet Admin API — Target Architecture

    Person(adminUser, "Admin / Operator", "Uses the admin web dashboard")

    System_Boundary(admin, "Admin BFF") {
        Container(adminWeb, "Admin Web", "SPA (out of scope for this repo)", "The dashboard UI")
        Container(adminApi, "admin-api", "NestJS 11 / TypeScript", "Query aggregation, Kafka projections, command forwarding. Port 3001.")
        ContainerDb(adminRead, "admin_read schema", "Postgres, same instance as core_api", "Read models only. Phase 3.")
    }

    System_Boundary(platform, "Existing GeoFleet Platform") {
        Container(coreApi, "core-api", "Laravel 13", "Owns all business-domain writes. Port 8000.")
        ContainerDb(postgres, "Postgres", "core_api database", "System of record")
        Container(kafka, "Kafka", "Single broker, KRaft", "Event bus")
        ContainerDb(redis, "Redis", "Shared instance", "Live derived state")
    }

    Rel(adminUser, adminWeb, "Uses", "HTTPS")
    Rel(adminWeb, adminApi, "Queries + commands", "HTTPS, Bearer admin token")
    Rel(adminApi, adminRead, "Reads/writes its own projections", "SQL")
    Rel(adminApi, kafka, "Consumes domain events -> projections (Phase 4)", "Kafka protocol")
    Rel(adminApi, coreApi, "Forwards commands only: POST /internal/v1/... (Phase 6)", "HTTPS")
    Rel(adminApi, redis, "Reads live operational state where useful (Phase 7)", "Redis protocol")
    Rel(coreApi, postgres, "Owns schema; all business writes", "libpq")
    Rel(coreApi, kafka, "Publishes via transactional outbox", "Kafka protocol")

    UpdateRelStyle(adminApi, postgres, $offsetY="-40")
    Rel(adminApi, postgres, "NEVER: no direct read or write to core-api's tables", "✗")
```

The last relationship is drawn deliberately to make the forbidden edge
visible, not to describe real traffic — see "Critical architecture rule"
below.

## What's actually built (all 7 phases complete)

The diagram above was drawn as a *target* architecture in Phase 0/1; as of
Phase 7 it is the *actual* one — every relationship it draws is real,
live-verified traffic, not aspiration. Per phase (see
[overview.md](overview.md) for the full phase-by-phase detail and what
each one's own live verification found):

- **Phase 1** — HTTP server, config validation, structured logging,
  correlation-id propagation, response/error envelope, `/health` +
  `/ready`, Prometheus `/metrics`, Swagger at `/docs`.
- **Phase 2** — Sanctum-token verification against Postgres directly (no
  call back into core-api), `AuthGuard`/`PermissionsGuard`, log-only audit
  foundation.
- **Phase 3** — the `admin_read` schema, owned outright by the `admin_api`
  role; Kysely migrations for 5 projection tables + inbox + region
  metrics.
- **Phase 4** — one Kafka consumer, 9 live topics, idempotent per-handler
  inbox pattern, `fromBeginning: true` historical backfill.
- **Phase 5** — 11 cursor-paginated, permission-gated query endpoints
  across dashboard/drivers/rides/trips/payments.
- **Phase 6** — core-api's `internal/v1/*` API (shared-secret
  authenticated) and 3 forwarded commands (`drivers.suspend`,
  `trips.cancel`, `payments.refund`), each landing as a real Postgres
  write, an `audit_logs` row, and — where a topic exists for it — a Kafka
  event.
- **Phase 7** — the only Redis reads beyond a health ping: a throttled,
  region-scoped live driver map, live driver counters, and a computed
  incident feed, all sourced from dispatch-service's own Redis index.

Nothing in the target diagram above is unbuilt or stubbed. The one
deliberate gap that remains isn't in admin-api at all: two of the five
`admin_read` projection tables (`admin_trip_projection`,
`admin_payment_projection`) stay empty because core-api itself has no
`trips`/`payments`-creating flow yet — a producer-side gap this service
can't close from its own side, documented in
[read-models.md](read-models.md) and revisited in every later phase's own
docs.

## Critical architecture rule: query/command separation

core-api owns core business operations and durable domain logic. admin-api
must never perform a business-state mutation (cancel a trip, assign a
driver, refund a payment, suspend a driver, ...) by writing directly to a
core-api-owned Postgres table.

```
Commands:  Admin Web -> admin-api -> core-api internal API -> domain logic -> Postgres -> outbox -> Kafka
Queries:   Kafka -> admin-api projection consumers -> admin_read -> admin-api -> Admin Web
```

**Why**: every hard invariant this platform relies on — the transactional
outbox, inbox idempotency, atomic ride acceptance (see the root
[AGENTS.md](../../AGENTS.md)) — is implemented once, inside core-api (and,
for the narrow slice each owns, the three Go services). Letting a second
service write to those same tables would mean re-implementing (or, more
likely, quietly violating) those invariants from a second, independent
codebase. This is the same reasoning that already kept dispatch-service
and realtime-gateway from getting broad write access to core-api's schema
(see [ADR 0005](../decisions/0005-geohash-and-dispatch-db-access.md),
[ADR 0006](../decisions/0006-realtime-gateway-fanout.md)) — admin-api is
held to a *stricter* version of the same rule: those two Go services at
least got narrow, audited grants for the one write each strictly needs
(dispatch-service's offer acceptance, nothing for realtime-gateway).
admin-api gets none, because it has no equivalent single-row-conditional-
UPDATE need — every admin command is inherently a multi-step business
decision (a cancellation reason, a refund amount, an audit trail) that
belongs in the domain layer, not a BFF.

## Technology choices (Phase 1)

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node 22 LTS | No existing Node convention in this repo (core-api's `package.json` is Vite/Tailwind tooling only) — current LTS, stated explicitly rather than left implicit. |
| Framework | NestJS 11 | Explicitly requested; mature, actively maintained, and its module/DI system matches this platform's existing "own config, own logger, own metrics registry per service" convention naturally. |
| Config validation | `@nestjs/config` + Joi | Fails fast on boot with a clear message if the environment is misconfigured — same intent as core-api's `.env.example` conventions, enforced at startup instead of documented only. |
| Logging | `nestjs-pino` | Structured JSON logs, matching core-api's `Log::shareContext` and every Go service's `log/slog` usage — one correlation id shared across every log line for a request. |
| Health checks | `@nestjs/terminus` | Standard NestJS health-check plumbing (per-indicator up/down, automatic 503 on failure) — mirrors the shape of each Go service's own `Pinger`-based `/readyz` handler without hand-rolling the same thing a third time. |
| Metrics | `prom-client`, own `Registry` | Same "own registry, not the global default" rule every Go service's `internal/metrics` package already follows. |
| HTTP client (core-api calls) | `@nestjs/axios` | Used today only for the `/ready` core-api indicator; will be the base for the Phase 6 Laravel integration client (timeout, correlation-id propagation, structured errors). |
| Kafka client | `kafkajs` | Used today only for the `/ready` broker-reachability check (`admin().listTopics()`); mature, actively maintained, the de facto standard Node Kafka client — will back the Phase 4 projection consumers. |
| Redis client | `ioredis` | Used today only for the `/ready` ping; mature, actively maintained, the most common choice in the NestJS ecosystem — will back any Phase 7 live-state reads. |
| Security headers | `helmet` | Standard, low-risk hardening with no functional trade-off. |
| Rate limiting | `@nestjs/throttler`, global default (100 req/min/IP) | A conservative floor applied now so even `/health`/`/docs` aren't unprotected; Phase 2 will add a tighter, endpoint-specific policy once real auth/command endpoints exist (mirrors core-api's `throttle:auth` on `/auth/*`). |
| Response/error envelope | Hand-rolled interceptor + filter | Small enough not to need a library; shape deliberately mirrors core-api's `App\Support\ApiError` (`{ error: { code, message, correlation_id } }`) so admin-web never has to special-case which backend produced an error. |

Database ORM (Kysely, recommended in Phase 0) isn't installed yet — that
choice becomes real in Phase 3 alongside the first actual schema.

## Correlation-id propagation

Same convention as the rest of the platform
([docs/events/event-envelope.md](../events/event-envelope.md)): reuse a
client-supplied `X-Correlation-Id` if present and a valid UUID, otherwise
generate one. `src/common/middleware/correlation-id.middleware.ts` sets it
before anything else runs; `nestjs-pino`'s `genReqId` reuses the same
value so request logs, the error envelope, and the response header always
agree. Phase 6 will propagate it onward into core-api internal API calls
the same way core-api's own `AssignCorrelationId` middleware already
shares it into `Log::shareContext` and the outbox envelope.
