# infrastructure/monitoring

Prometheus scrape configuration and related monitoring config. Added when
services expose `/metrics` endpoints (Phase 3+). Full observability stack
(dashboards, alerting) is intentionally out of scope for the local MVP —
see the brief's Observability section for what each service must expose in
the meantime (structured logs, health/readiness endpoints, basic counters).
