/**
 * Every topic admin-api's projection consumer subscribes to — deliberately
 * a subset of docs/events/topic-catalog.md, not every topic that exists.
 *
 * Excluded on purpose: `trip.started/completed/cancelled.v1` and
 * `payment.requested/completed/failed.v1` are all "planned" in the topic
 * catalog — no producer exists in core-api yet (see
 * docs/architecture/data-flow.md's Flow 1 note and
 * docs/admin-api/read-models.md). Subscribing to a topic that never
 * receives a message would be untested, unverifiable code — the same
 * principle this repo has already applied everywhere else a producer-side
 * gap exists. Add these once core-api's trip-lifecycle/payment
 * integration makes them real.
 */
export const ADMIN_API_KAFKA_TOPICS = [
  'driver.status.changed.v1',
  'driver.location.validated.v1',
  'ride.requested.v1',
  'ride.search.started.v1',
  'ride.offer.created.v1',
  'ride.offer.accepted.v1',
  'ride.offer.rejected.v1',
  'ride.assigned.v1',
  'ride.unavailable.v1',
] as const;
