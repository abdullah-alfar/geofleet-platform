#!/usr/bin/env bash
# Registers a new driver. Same endpoint as 01, different `role` — but
# RegisterRequest's `required_if:role,driver` rules kick in for the
# license fields, and AuthController::register creates a `drivers` row
# (status defaults to 'pending_review' — see
# database/migrations/2026_08_06_100020_create_drivers_table.php) instead
# of a `customers` row.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STAMP="$(date +%s)$RANDOM"

step "Register driver" "apps/core-api/app/Http/Controllers/Api/V1/AuthController.php::register"
req POST "$CORE_API_URL/api/v1/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"name\": \"Test Driver\",
    \"email\": \"driver.${STAMP}@example.com\",
    \"phone\": \"+96278${STAMP: -7}\",
    \"password\": \"password123\",
    \"password_confirmation\": \"password123\",
    \"role\": \"driver\",
    \"license_number\": \"LIC-${STAMP}\",
    \"license_expires_at\": \"2030-01-01\"
  }"

TOKEN="$(echo "$RESPONSE" | jq -r '.meta.token')"
DRIVER_USER_ID="$(echo "$RESPONSE" | jq -r '.data.id')"
DRIVER_ID="$(echo "$RESPONSE" | jq -r '.data.driver.id')"
DRIVER_STATUS="$(echo "$RESPONSE" | jq -r '.data.driver.status')"

save DRIVER_TOKEN "$TOKEN"
save DRIVER_USER_ID "$DRIVER_USER_ID"
save DRIVER_ID "$DRIVER_ID"

ok "Saved DRIVER_TOKEN, DRIVER_ID"
note "driver.status = ${DRIVER_STATUS} — 'pending_review' means this driver can log in and add a vehicle,"
note "but can't go available/be matched until an admin approves them. See 06-admin-approve-driver.sh."
