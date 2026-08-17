#!/usr/bin/env bash
# Sanity check: is everything actually running before we test anything real?
# No auth, no state needed — safe to run any time, first thing.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

step "core-api" "apps/core-api/bootstrap/app.php (health: '/up')"
req GET "$CORE_API_URL/up" || true

step "location-service" "apps/location-service/internal/httpapi/health.go"
req GET "$LOCATION_URL/healthz" || true
req GET "$LOCATION_URL/readyz" || true

step "dispatch-service" "apps/dispatch-service/internal/httpapi/health.go"
req GET "$DISPATCH_URL/healthz" || true
req GET "$DISPATCH_URL/readyz" || true

step "realtime-gateway" "apps/realtime-gateway/internal/httpapi/health.go"
req GET "$REALTIME_URL/healthz" || true
req GET "$REALTIME_URL/readyz" || true

step "admin-api (optional — only needed for 14/15)" "apps/admin-api/src/health"
req GET "$ADMIN_API_URL/health" || true

echo
note "Anything red above needs to be started first — see docs/local-development-without-docker.md"
