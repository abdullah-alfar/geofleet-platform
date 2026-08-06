# dispatch-service

Go 1.26.3 service — scaffolded in Phase 5.

Consumes `ride.requested.v1`, finds and ranks nearby available drivers
(H3-based candidate search), creates and expires ride offers, and performs
atomic ride acceptance to prevent double-assignment.
