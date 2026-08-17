#!/usr/bin/env bash
# Driver goes available. This writes an outbox_events row in the same
# transaction as the drivers table update (App\Domain\Outbox\Outbox —
# the "transactional outbox" pattern AGENTS.md calls a hard invariant) —
# nothing downstream (location-service, dispatch-service) sees this
# until your `php artisan outbox:publish` loop picks it up and sends
# driver.status.changed.v1 to Kafka.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
load
require DRIVER_TOKEN

step "Go available" "apps/core-api/app/Http/Controllers/Api/V1/DriverAvailabilityController.php::update"
req PATCH "$CORE_API_URL/api/v1/driver/availability" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $DRIVER_TOKEN" \
  -d '{"is_available": true}'

note "If this driver isn't 'active' yet (see 06-admin-approve-driver.sh), the write still succeeds — only"
note "'suspended' blocks it (see the controller's own comment on the 403 branch). Matching later just won't find them."
