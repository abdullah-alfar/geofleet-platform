# core-api

Laravel 13 application — scaffolded in Phase 2.

Owns: authentication, customer/driver/vehicle profiles, ride requests,
trips, payments, admin dashboard, roles/permissions, audit logs,
transactional outbox publisher, and Kafka result-event consumers.

Does not process high-frequency GPS traffic — that's `location-service`.
