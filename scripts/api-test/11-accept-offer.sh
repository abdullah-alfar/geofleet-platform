#!/usr/bin/env bash
# Driver accepts the offer. internal/offers.Service.Accept() does a single
# conditional UPDATE (never read-then-write) so exactly one driver can win
# a given offer — the same "atomic acceptance" invariant AGENTS.md
# requires. Publishes ride.assigned.v1 on success.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load
require DEVICE_TOKEN OFFER_ID

step "Accept offer" "apps/dispatch-service/internal/httpapi/offer_handlers.go::Accept -> internal/offers/service.go::Accept"
req POST "$DISPATCH_URL/v1/ride-offers/${OFFER_ID}/accept" \
  -H "Authorization: Bearer $DEVICE_TOKEN"

step "Accept the SAME offer again (negative case)" "offers.ErrOfferNotAvailable branch"
req POST "$DISPATCH_URL/v1/ride-offers/${OFFER_ID}/accept" \
  -H "Authorization: Bearer $DEVICE_TOKEN" || true
note "409 offer_not_available — the conditional UPDATE affected 0 rows the second time. This IS the atomicity guarantee, not an error in the kit."
