#!/usr/bin/env bash
# Polls dispatch-service for a pending ride offer, as the driver's device.
# The matching itself happens in internal/matching (triggered by consuming
# ride.requested.v1 — see internal/indexconsumers and cmd/dispatch-service/
# main.go's consumer wiring), not by this poll — ListPending just reads
# whatever internal/offerstore already has. Real clients would get this
# pushed over realtime-gateway's WebSocket instead of polling; see
# 15-realtime-ws.py for that path.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load
require DEVICE_TOKEN

step "Poll for a pending offer" "apps/dispatch-service/internal/httpapi/offer_handlers.go::ListPending"

for i in $(seq 1 10); do
  echo "${DIM}   attempt $i/10${RESET}"
  req GET "$DISPATCH_URL/v1/ride-offers/pending" -H "Authorization: Bearer $DEVICE_TOKEN"

  OFFER_ID="$(echo "$RESPONSE" | jq -r '.data[0].offer_id // empty')"
  if [ -n "$OFFER_ID" ]; then
    save OFFER_ID "$OFFER_ID"
    ok "Saved OFFER_ID"
    exit 0
  fi
  sleep 1.5
done

fail "No offer showed up after 10 attempts. Checklist:"
note "  - is 'watch -n 2 php artisan outbox:publish' actually running? (nothing reaches Kafka without it)"
note "  - did 06-admin-approve-driver.sh run (driver must be 'active', not 'pending_review')?"
note "  - did 07-go-available.sh and 08-submit-gps.sh both run for THIS driver?"
note "  - is dispatch-service's own log showing it consumed ride.requested.v1 at all?"
exit 1
