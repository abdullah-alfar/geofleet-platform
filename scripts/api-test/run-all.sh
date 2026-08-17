#!/usr/bin/env bash
# Runs the full happy-path ride lifecycle end to end: register -> approve
# -> go available -> GPS -> request a ride -> match -> accept -> verify.
# Each step is also its own standalone script (this just chains them) —
# stop this at any point (Ctrl+C) and re-run an individual NN-*.sh while
# reading the file it points at.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "Resetting .state so this is a clean run..."
: > .state

./00-health-check.sh
./01-register-customer.sh
./02-register-driver.sh
./04-add-vehicle.sh
./05-register-device.sh
./06-admin-approve-driver.sh
./07-go-available.sh
./08-submit-gps.sh
./09-create-ride-request.sh
./10-check-offers.sh
./11-accept-offer.sh
./12-verify-ride-assigned.sh

echo
echo "Done. .state has every id/token from this run if you want to poke around manually with curl."
echo "Optional next steps: ./03-login.sh, ./13-cancel-ride-request.sh, ./14-admin-api-session.sh, ./15-realtime-ws.py"
