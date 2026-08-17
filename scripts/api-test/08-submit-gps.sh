#!/usr/bin/env bash
# Submits one GPS ping as the driver's device — this is location-service's
# only endpoint. Walk the request through internal/httpapi/location_handler.go
# -> internal/validation (rejects stale/future/implausible-speed points) ->
# internal/redisstore (writes the "latest location" key dispatch-service's
# geohash index reads) -> internal/kafka (publishes driver.location.validated.v1).
#
# Coordinates are Rainbow St, Amman — the same pickup point 09 uses, so
# this driver is geographically close enough for dispatch-service to
# consider them a match.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load
require DRIVER_ID DEVICE_ID DEVICE_TOKEN

# Epoch-seconds sequence: always increasing, even across separate runs of
# this script (real clients would track their own monotonic counter).
SEQUENCE="$(date +%s)"
RECORDED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

step "Submit GPS update" "apps/location-service/internal/httpapi/location_handler.go"
req POST "$LOCATION_URL/v1/locations" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DEVICE_TOKEN" \
  -d "{
    \"driver_id\": \"$DRIVER_ID\",
    \"device_id\": \"$DEVICE_ID\",
    \"trip_id\": null,
    \"sequence\": $SEQUENCE,
    \"latitude\": 31.9539,
    \"longitude\": 35.9106,
    \"accuracy_meters\": 8.5,
    \"speed_mps\": 12.4,
    \"heading_degrees\": 140.0,
    \"recorded_at\": \"$RECORDED_AT\"
  }"

note "Rate limit: internal/validation caps this at MAX_UPDATES_PER_WINDOW (default 2) per RATE_LIMIT_WINDOW (default 1s)."
note "Run this script twice back-to-back with no delay to see the 429."
