# ADR 0003: Monorepo containing Laravel core-api and Go services

## Status
Accepted

## Context
The platform is composed of four independently deployable services (one
Laravel app, three Go services) that share event contracts (Kafka topic
schemas) and, eventually, an OpenAPI spec. The repository started empty, so
there was no existing structure to preserve or migrate.

Options considered:
- **Polyrepo** (one repository per service) — clean deployment isolation,
  but shared event contract changes (e.g. adding a field to the GPS event
  envelope) require coordinated multi-repo PRs and versioned contract
  packages from day one, which is unnecessary overhead for a project still
  finding its shape.
- **Monorepo** — one repository, `apps/*` per deployable service,
  `contracts/*` shared between all of them, `infrastructure/*` for local
  Docker Compose config, `docs/*` for architecture/ADRs. Contract changes
  are visible in the same PR as the code that depends on them.

## Decision
Use a monorepo with the structure:

```
apps/core-api/            Laravel 13
apps/location-service/    Go 1.26.3
apps/dispatch-service/    Go 1.26.3
apps/realtime-gateway/    Go 1.26.3
contracts/events/         Event schemas (JSON Schema per topic/version)
contracts/openapi/        OpenAPI spec for core-api's REST surface
infrastructure/           Docker Compose init scripts and configs (Kafka, Postgres, Redis)
docs/                     Architecture, events, database, and decision docs
scripts/                  Local developer tooling
```

Each `apps/*` service keeps its own dependency manifest (`composer.json` for
core-api, `go.mod` per Go service) and can still be extracted into its own
repository later if deployment needs diverge — the folder boundary is
already a service boundary, so extraction is a `git subtree split`-style
operation, not a rewrite.

## Consequences
- Single `docker-compose.yml` and a single `.env` can wire up the whole
  local stack (see Phase 1 infrastructure).
- CI (when introduced) needs path-based filtering to avoid rebuilding every
  service on every change — not needed yet at this stage, but noted so it
  isn't a surprise later.
- Go services do not share a single `go.mod` — each is its own module under
  `apps/<service>/`, keeping dependency graphs independent even though the
  code lives in one repository.
