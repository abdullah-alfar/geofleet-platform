#!/usr/bin/env bash
# Registers a new customer. Every field's validation rule lives in
# App\Http\Requests\Auth\RegisterRequest — open that file alongside this
# script to see exactly why each field is shaped the way it is below.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STAMP="$(date +%s)$RANDOM"

step "Register customer" "apps/core-api/app/Http/Controllers/Api/V1/AuthController.php::register"
req POST "$CORE_API_URL/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Test Rider\",
    \"email\": \"rider.${STAMP}@example.com\",
    \"phone\": \"+96279${STAMP: -7}\",
    \"password\": \"password123\",
    \"password_confirmation\": \"password123\",
    \"role\": \"customer\"
  }"

TOKEN="$(echo "$RESPONSE" | jq -r '.meta.token')"
CUSTOMER_ID="$(echo "$RESPONSE" | jq -r '.data.id')"

save CUSTOMER_TOKEN "$TOKEN"
save CUSTOMER_ID "$CUSTOMER_ID"

ok "Saved CUSTOMER_TOKEN, CUSTOMER_ID"
note "Sanctum issues this token in AuthController::issueTokenFor() — grep that to see the abilities it's scoped with."
