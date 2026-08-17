#!/usr/bin/env bash
# Registers a GPS device for the driver. This issues a SEPARATE credential
# from DRIVER_TOKEN — see the comment in
# App\Http\Controllers\Api\V1\DriverDeviceController::store: the device
# token is what location-service and dispatch-service authenticate
# against (07/08/11 below), not the Sanctum user session token.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load
require DRIVER_TOKEN

step "Register device" "apps/core-api/app/Http/Controllers/Api/V1/DriverDeviceController.php::store"
req POST "$CORE_API_URL/api/v1/driver/devices" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -d "{
    \"device_identifier\": \"test-device-$RANDOM\",
    \"platform\": \"android\",
    \"app_version\": \"1.0.0\"
  }"

DEVICE_ID="$(echo "$RESPONSE" | jq -r '.data.id')"
DEVICE_TOKEN="$(echo "$RESPONSE" | jq -r '.meta.device_token')"

save DEVICE_ID "$DEVICE_ID"
save DEVICE_TOKEN "$DEVICE_TOKEN"

ok "Saved DEVICE_ID, DEVICE_TOKEN"
warn "This is the ONLY time the plaintext device token is ever returned — only its SHA-256 hash is persisted (DriverDevice::generateToken())."
