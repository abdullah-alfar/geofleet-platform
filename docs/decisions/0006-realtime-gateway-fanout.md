# ADR 0006: realtime-gateway's fan-out mechanism, correlation state, and Postgres access

## Status
Accepted

## Context
Phase 6 needed a way to push already-live Kafka events (`ride.offer.created.v1`,
`ride.assigned.v1`, `ride.unavailable.v1`, `driver.location.validated.v1`) to
the right browser/app WebSocket connection, in a way that scales to more
than one realtime-gateway instance — the brief's explicit "multi-instance
fan-out" requirement for this phase.

### Multi-instance fan-out: Redis Pub/Sub, not per-instance Kafka replication

Every other consumer group in this platform is partitioned: N instances of
a service split a topic's partitions between them, and each instance only
ever sees a subset of records. That's the wrong shape for realtime-gateway,
because a WebSocket connection lives on exactly one instance — if Kafka
partitioning sent `ride.offer.created.v1` for driver X to instance B while
driver X's socket is open on instance A, the message would never reach
them under the standard partitioned-consumer-group model alone.

Two ways to fix that were considered:
1. Give every instance its **own** consumer group (or otherwise force full
   topic replication to each instance), so every instance sees every
   event and can check its own local connection table.
2. Keep one partitioned consumer group (like everything else), and relay
   through **Redis Pub/Sub**: whichever instance's Kafka consumer handles
   a record publishes it to a channel keyed by the target driver/customer
   id; every instance subscribes to all such channels and forwards to a
   local connection if it holds one.

Chose (2). Full replication (1) multiplies Kafka consumer load by however
many gateway instances are running, and — worse — breaks offset semantics:
each instance's own consumer group would separately track "fully consumed"
for a topic that's also read by dispatch-service's/core-api's differently-
scoped consumer groups, for no benefit, since the actual bottleneck being
solved is delivery-to-connection, not event consumption. Redis Pub/Sub
fan-out keeps Kafka consumption exactly like every other service (one
partitioned group) and pushes the "does anyone need this specific
driver/customer id" problem to a broadcast layer built for it.

**Every relay — even to a connection held by the same instance that
consumed the Kafka record — round-trips through Redis.** No "local fast
path" special case. That means there's exactly one code path to reason
about and test, and it behaves identically whether there's 1 instance
running locally or 10 in production.

Channels: `rt:driver:{driver_uuid}`, `rt:customer:{customer_uuid}` (see
`internal/hub`). A message published to a channel nobody's listening for
(e.g. an offline driver) is simply not delivered — Redis Pub/Sub has no
persistence or queuing, which is correct here: a driver who's offline when
offered a ride still has the offer sitting in Postgres
(`ride_offers.status = 'pending'`, `expires_at` in the future) and will see
it in a future WebSocket session if they reconnect before it expires, or
never see it if it expires first, same outcome the polling endpoint
(`GET /v1/ride-offers/pending`, Phase 5) already produces.

### Two ephemeral, TTL-bounded Redis mappings instead of a Postgres join

Two of the events realtime-gateway relays don't carry the id needed to
route them:

- `ride.unavailable.v1` carries only `ride_request_id`, not `customer_id`
  — deliberately, per Phase 5's dispatch-service scoping (it was never
  granted customer PII beyond what `ride.assigned.v1`'s payload needs).
- `driver.location.validated.v1` carries only `driver_id` — it has no
  concept of "which ride/customer," since apps/location-service doesn't
  know about ride assignment at all.

Two options: grant realtime-gateway a Postgres join to resolve these
(e.g. `SELECT customer_id FROM ride_requests WHERE uuid = ...`), or have
realtime-gateway derive the correlation itself from events it already
consumes. Chose the latter (`internal/relaystate`):

- `ride_request_id -> customer_id`, set from `ride.requested.v1` (which
  does carry both), read back for `ride.unavailable.v1`. TTL
  (`RIDE_CORRELATION_TTL`, default 30m) bounded by dispatch-service's own
  matching window (`OfferTTL * MaxOfferAttempts`, a few minutes at
  defaults) plus margin.
- `driver_id -> (ride_request_id, customer_id)`, set from
  `ride.assigned.v1`, read back for `driver.location.validated.v1`. TTL
  (`DRIVER_ASSIGNMENT_TTL`, default 4h) is a deliberate staleness bound,
  not a correctness guarantee — see the scope boundary below.

This keeps realtime-gateway's Postgres footprint limited to
authentication only (see below), consistent with it holding no durable
domain state of its own — everything it knows about an in-flight ride
comes from the Kafka events it's already consuming, the same events it's
relaying.

**Scope boundary — no trip-completion event exists yet.** The
`driver_id -> assignment` mapping should really be cleared the moment a
trip ends, so a customer stops receiving their former driver's location.
`trips.status` exists in the schema and `trip.completed.v1` is reserved in
the topic catalog, but nothing in core-api creates `trips` rows yet (no
`ride.assigned.v1` consumer exists there either — trip creation is a
core-api concern for a later phase, not built ahead of schedule here per
AGENTS.md). Until that exists, `DRIVER_ASSIGNMENT_TTL` is the only bound:
worst case, a customer keeps receiving their former driver's location for
up to the TTL after a trip actually ends. Revisit this the same phase
trip creation and `trip.completed.v1` land — clearing the mapping on that
event is the natural fix, no redesign needed.

### Postgres access: read-only, authentication only

The `realtime_gateway` role
(`apps/core-api/database/migrations/2026_08_09_200000_create_realtime_gateway_role.php`)
exists for exactly one purpose: verifying a WebSocket upgrade's bearer
credential. No domain tables (`ride_requests`, `ride_offers`, `trips`,
`customers` beyond identity, `payments`) are touched.

- `SELECT` on `driver_devices`, `drivers` — the identical device-token
  query apps/location-service and apps/dispatch-service already run. Same
  tables, same table-wide grant, no new pattern.
- Column-scoped `SELECT` on `personal_access_tokens`
  (`id, tokenable_id, tokenable_type, token, expires_at`), `users`
  (`id, status`), and `customers` (`uuid, user_id`) — just enough to
  replicate Sanctum's own `PersonalAccessToken::findToken()` lookup
  (split `"{id}|{plaintext}"`, hash the plaintext, match by id) and
  resolve which customer a token belongs to. This role never sees a
  password hash, email, phone, or name — narrower than
  dispatch-service's own `customers` grant (ADR 0005), which at least
  needed `id`; this one resolves everything through `user_id`.

### Why no transactional outbox, and no Kafka producer at all

realtime-gateway publishes nothing to Kafka — it's a pure relay from Kafka
to WebSocket. There's no "intent to publish" to make atomic with a
Postgres write, because there is no Postgres write in its critical path at
all (auth lookups are the only queries it runs, and they're read-only).
This is a simpler version of the same reasoning ADR 0005 gives for why
dispatch-service skips a transactional outbox: the pattern exists to keep
a domain write and its resulting event from diverging, and there's no
domain write here to diverge from.

### Reusing existing auth, not inventing a third mechanism

Drivers authenticate the WebSocket upgrade with the same device-token
credential (`Authorization: Bearer <device_token>`, SHA-256 hashed,
looked up in `driver_devices`) that apps/location-service (Phase 3) and
apps/dispatch-service (Phase 5) already use. Customers authenticate with
their existing core-api Sanctum bearer token — the same one issued by
`POST /api/v1/auth/login` and accepted by every core-api REST endpoint —
rather than inventing a separate WebSocket-specific token type. Both
endpoints also accept the token as a `?token=` query parameter, in
addition to the `Authorization` header: browsers cannot set custom headers
on a WebSocket upgrade request, so a query parameter is the only way a
browser-based client can authenticate at all. It carries the same
credential, just relocated — not a weaker mechanism.
