#!/usr/bin/env bash
# Customer requests a ride. This is where the "distributed system" part
# of the story actually starts: the write here also records an
# outbox_events row (ride.requested.v1) — your `outbox:publish` loop
# ships it to Kafka, dispatch-service consumes it and starts matching
# (see 10-check-offers.sh).
#
# Idempotency-Key: a real client generates one UUID per user tap and
# resends the SAME key on retry — RideRequestController::store returns
# the original row instead of creating a second ride. Try re-running this
# script with IDEMPOTENCY_KEY forced to the same value twice to see it.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load
require CUSTOMER_TOKEN

IDEMPOTENCY_KEY="$(cat /proc/sys/kernel/random/uuid 2>/dev/null || python3 -c 'import uuid;print(uuid.uuid4())')"

step "Create ride request" "apps/core-api/app/Http/Controllers/Api/V1/RideRequestController.php::store"
req POST "$CORE_API_URL/api/v1/ride-requests" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" \
  -H "Idempotency-Key: $IDEMPOTENCY_KEY" \
  -d '{
    "pickup_lat": 31.9539,
    "pickup_lng": 35.9106,
    "pickup_address": "Rainbow St, Amman",
    "dropoff_lat": 31.9700,
    "dropoff_lng": 35.9500,
    "dropoff_address": "Abdali, Amman",
    "requested_vehicle_type": "sedan"
  }'

RIDE_REQUEST_ID="$(echo "$RESPONSE" | jq -r '.data.id')"
STATUS="$(echo "$RESPONSE" | jq -r '.data.status')"

save RIDE_REQUEST_ID "$RIDE_REQUEST_ID"
save IDEMPOTENCY_KEY "$IDEMPOTENCY_KEY"

ok "Saved RIDE_REQUEST_ID (status: ${STATUS})"
note "status starts 'searching'. It won't move to 'offered'/'matched' until:"
note "  1) your 'watch -n 2 php artisan outbox:publish' loop is running, AND"
note "  2) dispatch-service is running with a driver already available nearby (07 + 08)."
