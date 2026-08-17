#!/usr/bin/env bash
# Confirms the whole loop actually closed: the ride request core-api
# created in 09 now shows the driver who accepted it in 11 — reaching
# this row required 4 services agreeing with each other purely through
# Kafka events, no service called another directly.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load
require CUSTOMER_TOKEN RIDE_REQUEST_ID

step "Get ride request" "apps/core-api/app/Http/Controllers/Api/V1/RideRequestController.php::show"
req GET "$CORE_API_URL/api/v1/ride-requests/${RIDE_REQUEST_ID}" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN"

STATUS="$(echo "$RESPONSE" | jq -r '.data.status')"
DRIVER="$(echo "$RESPONSE" | jq -r '.data.driver.id // empty')"

if [ "$STATUS" = "accepted" ] || [ -n "$DRIVER" ]; then
  ok "Matched. status=${STATUS}, driver=${DRIVER}"
else
  warn "status=${STATUS}, no driver yet — did 11-accept-offer.sh actually return 200?"
fi

step "List trips (known platform gap, not a bug in this kit)" "TripController::index"
req GET "$CORE_API_URL/api/v1/trips" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN"
note "Empty is expected: nothing in core-api consumes ride.assigned.v1 to create a trips row yet"
note "(see docs/events/topic-catalog.md's note on trip.location.updated.v1). The ride lifecycle"
note "this kit can exercise stops at 'accepted' — trips/payments aren't wired end-to-end in this repo yet."
