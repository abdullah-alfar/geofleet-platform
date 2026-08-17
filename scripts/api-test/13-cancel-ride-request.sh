#!/usr/bin/env bash
# An independent alt-path: create a SECOND ride request and cancel it
# before anyone accepts — doesn't touch state from 09-12, safe to run any
# time after 01 (needs only CUSTOMER_TOKEN).
#
# ride_requests.status is a real Postgres CHECK constraint (see
# database/migrations/2026_08_06_100050_create_ride_requests_table.php):
# 'searching' | 'offered' | 'accepted' | 'cancelled' | 'expired' | 'unavailable'.
# Cancel is only legal from 'searching'/'offered' — RideRequestController::cancel.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load
require CUSTOMER_TOKEN

step "Create a ride request to cancel" "RideRequestController::store"
req POST "$CORE_API_URL/api/v1/ride-requests" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Idempotency-Key: $(cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid;print(uuid.uuid4())')" \
  -d '{
    "pickup_lat": 31.9539, "pickup_lng": 35.9106,
    "dropoff_lat": 31.9700, "dropoff_lng": 35.9500,
    "requested_vehicle_type": "sedan"
  }'
CANCEL_ID="$(echo "$RESPONSE" | jq -r '.data.id')"

step "Cancel it" "RideRequestController::cancel"
req POST "$CORE_API_URL/api/v1/ride-requests/${CANCEL_ID}/cancel" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN"

step "Cancel it again (negative case)" "the abort(422, ...) branch"
req POST "$CORE_API_URL/api/v1/ride-requests/${CANCEL_ID}/cancel" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" || true
note "422 — already 'cancelled', not in ['searching','offered'] anymore."

step "Another customer's token trying to view/cancel this ride (negative case)" "RideRequestPolicy"
note "Register a second customer (01-register-customer.sh again, in a subshell) if you want to see the 403 here yourself —"
note "left as an exercise: the point is RideRequestPolicy::view/cancel, not this script."
