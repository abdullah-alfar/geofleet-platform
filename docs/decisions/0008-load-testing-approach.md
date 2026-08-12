# ADR 0008: Load-testing approach and seeding via a direct provisioning command

## Status
Accepted

## Context
Phase 8 needed a "lightweight load tool" (per the phase map in AGENTS.md)
to generate real traffic against the local stack and produce numbers for
[docs/architecture/scalability.md](../architecture/scalability.md).

### A custom Go tool, not k6/Locust/Gatling

Every established load-testing tool (k6, Locust, Gatling, JMeter, ...)
solves a harder problem than this platform actually has right now: a
scripted, multi-protocol, distributed request pattern with its own DSL,
reporting pipeline, and typically a separate runtime/language to install.
This platform's load-testing need is narrower — generate HTTP traffic
against a handful of known endpoints, using **real driver/customer
identities that must first exist**, and report on the result. Every
service already exposes exactly the latency/throughput data a load test
would want, as Prometheus histograms and counters (built in Phases 3–7
for their own operational reasons, not for this). Reusing that
instrumentation instead of re-measuring latency client-side is both less
code and more accurate — no double-counting client-observed network RTT
as if it were server processing time.

`scripts/loadtest` is therefore a small, dependency-free Go program:
generate traffic through real HTTP calls (no mocking), scrape each
service's own `/metrics` before and after, diff, report. See its
[README](../../scripts/loadtest/README.md) for usage.

**Revisit if**: a future phase needs multi-region traffic, sustained
soak tests, or scripted user-behavior scenarios beyond "N drivers ping
GPS, M customers request rides" — that's when a real load-testing
framework's DSL starts earning its weight.

### Seeding bypasses the public HTTP registration endpoint — on purpose

`POST /api/v1/auth/register` is rate-limited to 10 requests/minute per IP
(`AppServiceProvider`'s `auth` `RateLimiter`) — brute-force and
account-enumeration protection, an explicit brief security requirement.
That's correct behavior for real traffic, and it makes that endpoint
structurally the wrong tool for bulk test-data provisioning: a load test
running from one machine (one IP) can never register more than 10
synthetic accounts a minute through it, no matter how much concurrency
the load tool itself is given.

Provisioning test drivers/customers isn't part of what this phase is
actually trying to measure — GPS ingestion and ride-matching throughput
are. So `apps/core-api/app/Console/Commands/LoadTestSeed.php`
(`php artisan loadtest:seed`) creates accounts directly via Eloquent,
bypassing the HTTP layer (and its rate limiter) entirely, while the load
tool's actual measured traffic — GPS pings, ride-request creation —
still goes through the real HTTP APIs, unmodified. This is the same
principle as [ADR 0006](0006-realtime-gateway-fanout.md) reusing existing
auth instead of inventing a new mechanism, applied in the opposite
direction: don't route synthetic test setup through a control built to
gate real traffic.

Two things `LoadTestSeed` has to do that a raw `INSERT` wouldn't:

- **Skip the (not-yet-built) admin driver-approval step**, the same way
  this repo's own manual verification always has — force-setting
  `status = 'active'` directly, since `#[Fillable]` on `Driver` doesn't
  allow it via mass assignment (a deliberate protection against a
  self-registered driver setting their own status — correctly in the way
  here, so it's worked around with `forceFill`, not loosened).
- **Publish `driver.status.changed.v1` directly** via the same
  `KafkaProducer` the outbox publisher uses, instead of going through
  `outbox_events`. This is the one event `PATCH /api/v1/driver/availability`
  produces that a raw column write can't: without it,
  dispatch-service's Redis geo-index (`internal/driverindex`) never learns
  a seeded driver is available, and every one of them would be invisible
  to matching regardless of how many GPS updates they send. Publishing
  directly rather than via the outbox table is safe here specifically
  because this is synthetic test data with no domain-write atomicity
  requirement to preserve (see AGENTS.md's transactional-outbox invariant,
  which this deliberately doesn't need) — and it means the load tool
  doesn't have to wait out an outbox-polling interval before its GPS phase
  starts.

**Revisit if**: an admin-approval endpoint is built (Phase 2's own
documented gap, not this phase's), at which point this command should use
it instead of `forceFill`, same as any other caller would.
