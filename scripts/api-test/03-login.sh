#!/usr/bin/env bash
# Registering already returns a token (01/02) — this script exists to
# exercise the *separate* login path, and its failure modes, since a real
# client re-authenticates far more often than it registers.
#
# Needs the customer email from 01, which we don't save (only the token) —
# so this re-registers a throwaway account rather than depending on 01's
# exact email. Run 01 first anyway if you want to compare the two flows.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STAMP="$(date +%s)$RANDOM"
EMAIL="login-test.${STAMP}@example.com"

step "Register a throwaway account to log in against" "AuthController::register"
req POST "$CORE_API_URL/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Login Test\",
    \"email\": \"${EMAIL}\",
    \"password\": \"password123\",
    \"password_confirmation\": \"password123\",
    \"role\": \"customer\"
  }" > /dev/null

step "Login — correct password" "apps/core-api/app/Http/Controllers/Api/V1/AuthController.php::login"
req POST "$CORE_API_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"${EMAIL}\", \"password\": \"password123\"}"
note "Every login issues a NEW Sanctum token — the one from registration still works too (tokens aren't rotated/invalidated)."

step "Login — wrong password (negative case)" "same method, the Hash::check() branch"
req POST "$CORE_API_URL/api/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\": \"${EMAIL}\", \"password\": \"wrong-password\"}" || true
note "422, not 401 — Laravel's ValidationException. Also: same error whether the email exists or not (see the code comment)."

step "GET /auth/me without a token (negative case)" "Sanctum's auth:sanctum middleware, not app code"
req GET "$CORE_API_URL/api/v1/auth/me" || true
note "401 before AuthController::me ever runs — the route-level middleware in routes/api.php rejects it first."
