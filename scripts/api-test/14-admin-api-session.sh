#!/usr/bin/env bash
# The admin surface's OWN auth path — separate from everything above.
# Admins log in through core-api's shared /auth/login (see ADR 0009,
# same endpoint customers/drivers use), then admin-api verifies that
# same token against its own /session before trusting it for anything else.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load

if [ -z "${ADMIN_EMAIL:-}" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  STAMP="$(date +%s)$RANDOM"
  ADMIN_EMAIL="admin.${STAMP}@example.com"
  step "Provision a super_admin" "apps/core-api/app/Console/Commands/CreateAdmin.php"
  (cd "$REPO_ROOT/apps/core-api" && php artisan admin:create "$ADMIN_EMAIL" "API Test Admin" super_admin --password=AdminPass123)
  save ADMIN_EMAIL "$ADMIN_EMAIL"
  save ADMIN_PASSWORD "AdminPass123"
fi

step "Login as admin (core-api)" "AuthController::login — same endpoint every role uses"
req POST "$CORE_API_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"${ADMIN_EMAIL}\", \"password\": \"${ADMIN_PASSWORD}\"}"
ADMIN_TOKEN="$(echo "$RESPONSE" | jq -r '.meta.token')"
save ADMIN_TOKEN "$ADMIN_TOKEN"

step "Verify session (admin-api)" "apps/admin-api/src/modules/auth/*.ts — GET /api/v1/admin/session"
req GET "$ADMIN_API_URL/api/v1/admin/session" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
note "admin-api re-verifies the token itself (TokenVerificationService) — it never trusts core-api's role claim blindly."

step "Same token, without Authorization header (negative case)" "AuthGuard"
req GET "$ADMIN_API_URL/api/v1/admin/session" || true

step "List drivers (admin-api proxies to core-api's internal/v1 API)" "apps/admin-api/src/modules/drivers/drivers.service.ts"
req GET "$ADMIN_API_URL/api/v1/admin/drivers" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
note "No Kafka in this path — admin-api calls core-api's internal/v1/drivers directly and reshapes the response."
note "See docs/admin-api/query-apis.md for why (and what changed when the old Kafka-projection read model was removed)."
