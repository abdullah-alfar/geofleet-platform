# core-api

Laravel 13 application. Owns authentication, customer/driver/vehicle
profiles, ride requests, trips, payments, and the transactional outbox
publisher. Does not process high-frequency GPS traffic — that's
`apps/location-service` (Go, Phase 3).

See the repo-root [README.md](../../README.md) for the full local quick
start (infrastructure + this app together), [AGENTS.md](../../AGENTS.md)
for the hard invariants this app must uphold (transactional outbox, inbox
idempotency, atomic ride acceptance, UUID public identifiers), and
[contracts/openapi/openapi.yaml](../../contracts/openapi/openapi.yaml) for
the REST API spec.

With the app running, `GET /docs` renders that spec as interactive Redoc
documentation (local environment only — see
`App\Http\Middleware\EnsureLocalEnvironment`), and
[contracts/postman/](../../contracts/postman/) has a ready-to-import
Postman collection covering the same endpoints.

## Structure

```
app/
  Console/Commands/PublishOutboxEvents.php           Transactional outbox publisher (`artisan outbox:publish`)
  Console/Commands/ConsumeLocationUpdates.php        Location consumer (`artisan kafka:consume-location-updates`)
  Console/Commands/ConsumeLocationUpdatesRetry.php   Isolated retry-topic consumer (Phase 7 — see ADR 0007)
  Console/Commands/PruneInboxEvents.php              Inbox retention (`artisan inbox:prune`, scheduled daily)
  Contracts/KafkaProducer.php                        Producer interface (rdkafka implementation in Infrastructure/)
  Domain/Outbox/Outbox.php                           Builds the event envelope + writes outbox_events rows
  Domain/Location/LocationSampler.php                Trip GPS sampling + trip.location.updated.v1 republish decision
  Domain/Location/LocationUpdateProcessor.php        Idempotent core shared by the main + retry consumers
  Domain/Reliability/RetryEnvelope.php               Retry/DLQ message shape (see docs/decisions/0007)
  Casts/GeographyPoint.php                           PostGIS geography(Point,4326) <-> App\ValueObjects\GeoPoint
  Http/Controllers/Api/V1/                           REST endpoints
  Http/Middleware/AssignCorrelationId.php            Correlation id propagation (requests -> events -> logs)
  Policies/                                          Per-resource ownership checks (IDOR protection)
  Support/ApiError.php                               Consistent JSON error envelope for all API exceptions
database/migrations/                                 Schema (see docs/database/schema-overview.md at repo root)
```

## Local commands

```bash
php artisan migrate                              # apply schema
php artisan outbox:publish                       # publish unpublished outbox events to Kafka (run on an interval)
php artisan kafka:consume-location-updates        # samples trip GPS routes from driver.location.validated.v1 (long-running)
php artisan kafka:consume-location-updates-retry  # isolated retry-topic consumer, see docs/decisions/0007 (long-running)
php artisan inbox:prune                           # deletes inbox_events rows past the retention window (normally scheduled, see routes/console.php)
php artisan schedule:work                         # runs the scheduler locally (drives inbox:prune)
php artisan route:list --path=api
```

See [docs/events/retry-and-dlq.md](../../docs/events/retry-and-dlq.md) and
[ADR 0007](../../docs/decisions/0007-retry-dlq-strategy.md) for what the
retry consumer and inbox pruning actually do and why.
