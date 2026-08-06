# location-service

Go 1.26.3 service — scaffolded in Phase 3.

Receives GPS updates from driver devices, validates them (range, staleness,
impossible jumps, rate limits), writes latest location to Redis, and
publishes validated events to Kafka (`driver.location.*`).
