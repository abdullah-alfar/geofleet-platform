# realtime-gateway

Go 1.26.3 service — scaffolded in Phase 6.

Terminates WebSocket connections, authorizes trip/driver/ride-request
subscriptions, and streams location and status updates to customers and
drivers. Designed to run as multiple stateless-ish instances from day one
(fan-out mechanism decided in Phase 6).
