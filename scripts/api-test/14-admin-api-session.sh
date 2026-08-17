#!/usr/bin/env bash
# The admin surface's OWN auth path — separate from everything above.
# admin-api handles login itself now (bcrypt-verifies users.password
# directly, mints its own admin_sessions token) — no call to core-api at
# all anymore. See docs/decisions/0011-admin-api-independent-service.md
# (supersedes ADR 0009's "admins share core-api's Sanctum /auth/login"
# design).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load

if [ -z "${ADMIN_EMAIL:-}" ]; then
  REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
  STAMP="$(date +%s)$RANDOM"
  ADMIN_EMAIL="admin.${STAMP}@example.com"
  step "Provision a super_admin" "apps/core-api/app/Console/Commands/CreateAdmin.php"
  note "Provisioning stays core-api's artisan command — the one legitimate remaining core-api touchpoint, run out-of-band by an operator, not called over HTTP by admin-api."
  (cd "$REPO_ROOT/apps/core-api" && php artisan admin:create "$ADMIN_EMAIL" "API Test Admin" super_admin --password=AdminPass123)
  save ADMIN_EMAIL "$ADMIN_EMAIL"
  save ADMIN_PASSWORD "AdminPass123"
fi

step "Login as admin (admin-api's own /auth/login)" "apps/admin-api/src/modules/auth/admin-auth.service.ts"
req POST "$ADMIN_API_URL/api/v1/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"${ADMIN_EMAIL}\", \"password\": \"${ADMIN_PASSWORD}\"}"
ADMIN_TOKEN="$(echo "$RESPONSE" | jq -r '.data.token')"
save ADMIN_TOKEN "$ADMIN_TOKEN"
note "admin-api bcrypt-verifies users.password directly and mints its own admin_sessions token — same generic 401 for a wrong password or a nonexistent email, no account enumeration."

step "Wrong password (negative case)" "same method's uniform-failure branch"
req POST "$ADMIN_API_URL/api/v1/admin/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"${ADMIN_EMAIL}\", \"password\": \"wrong-password\"}" || true
note "401 unauthenticated — identical error shape to a nonexistent email, deliberately."

step "Verify session (admin-api)" "apps/admin-api/src/modules/auth/token-verification.service.ts — GET /api/v1/admin/session"
req GET "$ADMIN_API_URL/api/v1/admin/session" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
note "Verifies against admin_sessions, admin-api's own table — joins users.status live on every call, so a deactivated admin is locked out on their very next request, not just their next login."

step "Same token, without Authorization header (negative case)" "AuthGuard"
req GET "$ADMIN_API_URL/api/v1/admin/session" || true

step "List drivers (direct SQL against core-api's own tables)" "apps/admin-api/src/modules/drivers/drivers.service.ts"
req GET "$ADMIN_API_URL/api/v1/admin/drivers" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
note "No HTTP call to core-api anywhere in this path — admin-api reads the drivers/users/vehicles tables directly, via its own broadened Postgres role."
note "See docs/decisions/0011-admin-api-independent-service.md for why (and what changed from the earlier REST-to-core-api design)."
