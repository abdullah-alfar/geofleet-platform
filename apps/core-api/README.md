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

## Structure

```
app/
  Console/Commands/PublishOutboxEvents.php   Transactional outbox publisher (`artisan outbox:publish`)
  Contracts/KafkaProducer.php                Producer interface (rdkafka implementation in Infrastructure/)
  Domain/Outbox/Outbox.php                   Builds the event envelope + writes outbox_events rows
  Casts/GeographyPoint.php                   PostGIS geography(Point,4326) <-> App\ValueObjects\GeoPoint
  Http/Controllers/Api/V1/                   REST endpoints
  Http/Middleware/AssignCorrelationId.php    Correlation id propagation (requests -> events -> logs)
  Policies/                                  Per-resource ownership checks (IDOR protection)
  Support/ApiError.php                       Consistent JSON error envelope for all API exceptions
database/migrations/                         Schema (see docs/database/schema-overview.md at repo root)
```

## Local commands

```bash
php artisan migrate              # apply schema
php artisan outbox:publish       # publish unpublished outbox events to Kafka (run on an interval)
php artisan route:list --path=api
```
