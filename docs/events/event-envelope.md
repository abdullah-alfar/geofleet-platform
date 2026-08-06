# Event Envelope

Every message this platform publishes to Kafka — from core-api (Laravel) or
any Go service — uses this envelope, wrapping event-specific data in
`data`:

```json
{
  "event_id": "b7660e02-16de-44cf-bfa5-a495839d2eaf",
  "event_type": "ride.requested",
  "event_version": 1,
  "occurred_at": "2026-08-06T09:58:36.114808Z",
  "producer": "core-api",
  "correlation_id": "482d2689-19cb-421d-b4cc-64dcdc031689",
  "causation_id": null,
  "aggregate_type": "ride_request",
  "aggregate_id": "b221403b-becb-4cc3-8c41-e15ed99ad07b",
  "region_id": "amman",
  "data": { "...": "event-specific fields" }
}
```

| Field | Meaning |
|---|---|
| `event_id` | Unique identity of this specific event instance. This is what inbox tables key on for idempotent consumption (`consumer_name` + `event_id` unique constraint — see AGENTS.md). |
| `event_type` | Dot-separated name, e.g. `ride.requested`. The Kafka topic is always `{event_type}.v{event_version}`. |
| `event_version` | Schema version for this event type. A breaking payload change ships as a new version/topic, not a mutation of an existing one. |
| `occurred_at` | UTC timestamp of when the event was generated (not when it's published — those can differ under outbox publisher lag). |
| `producer` | The service that emitted the event (`core-api`, `location-service`, `dispatch-service`, `realtime-gateway`). |
| `correlation_id` | Ties together everything that happened as part of one logical operation (an HTTP request, a GPS update) — propagated through logs and, where one event triggers another, into that next event's own `correlation_id`. |
| `causation_id` | The `event_id` of the event that directly caused this one, or `null` for a root event (e.g. one triggered directly by an HTTP request). Lets you reconstruct an event's causal chain, not just its correlation group. |
| `aggregate_type` / `aggregate_id` | The domain entity this event is about (e.g. `ride_request` / its UUID, `driver` / its UUID). `aggregate_id` is also what's used as the Kafka partition key for that topic — see [topic-catalog.md](topic-catalog.md). |
| `region_id` | The region this event belongs to (e.g. `amman`) — carried from day one even though only one region exists in local dev, so regional routing (brief's Regional Architecture section) is additive later, not a schema change. |
| `data` | Event-specific payload. Shape is versioned by `event_version`, not by inspecting `data` at runtime. |

## Producer implementations

- **core-api** (PHP): `App\Domain\Outbox\Outbox::record()` builds this
  envelope and writes it to `outbox_events.payload` in the same transaction
  as the domain write (transactional outbox — see
  [docs/decisions/0001](../decisions/0001-kafka-over-alternative-queues.md)).
  `php artisan outbox:publish` reads unpublished rows and sends them to
  Kafka unmodified.
- **Go services**: `internal/kafka.Envelope` in each service's source tree
  (currently `apps/location-service/internal/kafka/envelope.go`) mirrors
  this shape field-for-field. There's no shared Go module for this yet
  since only one Go service exists — if a second one needs it verbatim,
  that's the trigger to extract a shared internal package or a
  `contracts/events` Go module, not before.

## Correlation ID propagation

- **core-api**: `App\Http\Middleware\AssignCorrelationId` reuses a
  client-sent `X-Correlation-Id` header or generates one, binds it for the
  request (`App\Support\CorrelationContext`), and shares it into the log
  context (`Log::shareContext`) — so request logs, the outbox envelope, and
  the `X-Correlation-Id` response header all agree.
- **location-service**: `internal/httpapi` does the same thing
  (`correlationMiddleware`), independently, in Go — same header convention,
  same idea, no shared code (see note above).

## What this platform does *not* claim

At-least-once delivery only — see AGENTS.md. No event on this platform
should be assumed to arrive exactly once; every consumer that causes a
durable state change must be idempotent (inbox pattern).
