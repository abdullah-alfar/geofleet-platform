# contracts/postman

- `ridehailing-platform.postman_collection.json` — covers core-api
  (`/api/v1/...`) and location-service (`/v1/locations`, health/readiness/
  metrics). Mirrors [contracts/openapi/openapi.yaml](../openapi/openapi.yaml).
- `local.postman_environment.json` — variables the collection reads/writes
  (`base_url`, `location_service_url`, tokens, IDs).

## Usage

1. Import both files into Postman (or run headlessly with
   [Newman](https://github.com/postmanlabs/newman):
   `npx newman run ridehailing-platform.postman_collection.json -e local.postman_environment.json`).
2. Select the "Ride-Hailing Platform (Local)" environment.
3. Run folders top-to-bottom: **Auth → Drivers → Driver → Ride Requests →
   Trips → Location Service (Go)**. Register/login requests have test
   scripts that auto-save tokens and IDs (`customer_token`, `driver_id`,
   `device_token`, etc.) into the environment for later requests to reuse
   — you don't need to copy/paste anything manually.
4. **"Cleanup (run last)"** (just `Logout (Customer)`) is deliberately its
   own folder at the end of the collection, not part of `Auth` — revoking
   the customer's token right after login would break every later folder
   that needs it.

## Known gaps (not bugs)

- `Submit GPS Update` returns `422 driver_disabled` on a freshly-registered
  driver — expected, since there's no admin-approval endpoint yet (drivers
  default to `pending_review`, not `active`). Update the driver's status
  directly in Postgres to test the accepted path locally (see
  `apps/location-service/README.md`).
- `Get Trip` / `Cancel Ride Request` etc. need `{{trip_id}}` /
  `{{ride_request_id}}` already set — run the corresponding "create"
  request in the same folder run first.
