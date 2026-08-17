#!/usr/bin/env bash
# A driver adds a vehicle. Validation in App\Http\Requests\StoreVehicleRequest;
# the route itself is gated by the `role:driver` middleware (routes/api.php)
# — a customer token here gets a 403 before VehicleController runs at all,
# try it: swap DRIVER_TOKEN for CUSTOMER_TOKEN below and re-run.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load
require DRIVER_TOKEN

STAMP="$RANDOM"

step "Add vehicle" "apps/core-api/app/Http/Controllers/Api/V1/VehicleController.php::store"
req POST "$CORE_API_URL/api/v1/drivers/vehicles" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -d "{
    \"make\": \"Toyota\",
    \"model\": \"Corolla\",
    \"year\": 2022,
    \"color\": \"White\",
    \"plate_number\": \"TEST-${STAMP}\",
    \"vehicle_type\": \"sedan\"
  }"

VEHICLE_ID="$(echo "$RESPONSE" | jq -r '.data.id')"
save VEHICLE_ID "$VEHICLE_ID"
ok "Saved VEHICLE_ID"

step "List my vehicles" "VehicleController::index"
req GET "$CORE_API_URL/api/v1/drivers/vehicles" \
  -H "Authorization: Bearer $DRIVER_TOKEN"
