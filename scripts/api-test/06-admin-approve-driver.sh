#!/usr/bin/env bash
# Approves the driver from 02 so it can go available and be matched.
#
# This hits core-api's INTERNAL API directly (bypassing admin-api) — the
# same endpoint admin-api's DriversService.approve() forwards to (see
# apps/admin-api/src/modules/drivers/drivers.service.ts). Auth here is a
# shared secret header, not a bearer token — see
# App\Http\Middleware\VerifyInternalServiceToken and
# docs/decisions/0010-internal-service-authentication.md.
#
# AdminCommandRequest (the base class every internal/v1 command extends)
# also requires a real `admin_user_id` in the body, to attribute the
# action in audit_logs — so this script provisions one via `php artisan
# admin:create` if you don't already have one.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load
require DRIVER_ID

REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CORE_API_DIR="$REPO_ROOT/apps/core-api"

INTERNAL_TOKEN="$(grep -E '^ADMIN_API_INTERNAL_TOKEN=' "$CORE_API_DIR/.env" | cut -d= -f2-)"
if [ -z "$INTERNAL_TOKEN" ]; then
  fail "ADMIN_API_INTERNAL_TOKEN not found in apps/core-api/.env"
  exit 1
fi

if [ -z "${ADMIN_USER_ID:-}" ]; then
  step "Provision a super_admin (once)" "apps/core-api/app/Console/Commands/CreateAdmin.php"
  STAMP="$(date +%s)$RANDOM"
  ADMIN_EMAIL="admin.${STAMP}@example.com"
  note "cd apps/core-api && php artisan admin:create ${ADMIN_EMAIL} \"API Test Admin\" super_admin --password=AdminPass123"
  (cd "$CORE_API_DIR" && php artisan admin:create "$ADMIN_EMAIL" "API Test Admin" super_admin --password=AdminPass123)

  step "Login as that admin, to get their user uuid" "AuthController::login"
  req POST "$CORE_API_URL/api/v1/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"${ADMIN_EMAIL}\", \"password\": \"AdminPass123\"}"
  ADMIN_USER_ID="$(echo "$RESPONSE" | jq -r '.data.id')"
  save ADMIN_USER_ID "$ADMIN_USER_ID"
  save ADMIN_EMAIL "$ADMIN_EMAIL"
  save ADMIN_PASSWORD "AdminPass123"
fi

step "Approve driver" "apps/core-api/app/Http/Controllers/Api/Internal/V1/DriverCommandController.php::approve"
req PATCH "$CORE_API_URL/api/internal/v1/drivers/${DRIVER_ID}/approve" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Service-Token: ${INTERNAL_TOKEN}" \
  -d "{\"admin_user_id\": \"${ADMIN_USER_ID}\", \"reason\": \"api-test kit\"}"

note "status should now be 'active'. Re-running this script fails with 409 (Driver::where(...)->where('status','pending_review')->update() affects 0 rows)."
note "That 409 is itself worth seeing once — it's DriverCommandController's own idempotency guard, not a bug."
