// Package types defines the event payload shapes realtime-gateway decodes
// from Kafka — copied field-for-field from the producing services
// (core-api, apps/location-service, apps/dispatch-service) rather than
// imported, since there's no shared Go module for event schemas yet (see
// docs/events/event-envelope.md's note on this).
package types

import "time"

// RideRequested is the `data` payload of a ride.requested.v1 event
// (core-api's RideRequestController::store). realtime-gateway only reads
// RideRequestID and CustomerID, to build the ride->customer correlation
// used later for ride.unavailable.v1 (see internal/relaystate).
type RideRequested struct {
	RideRequestID string `json:"ride_request_id"`
	CustomerID    string `json:"customer_id"`
}

// RideOfferCreated is the `data` payload of a ride.offer.created.v1 event
// (apps/dispatch-service's matching.Matcher).
type RideOfferCreated struct {
	RideRequestID string    `json:"ride_request_id"`
	OfferID       string    `json:"offer_id"`
	DriverID      string    `json:"driver_id"`
	ExpiresAt     time.Time `json:"expires_at"`
}

// RideAssigned is the `data` payload of a ride.assigned.v1 event
// (apps/dispatch-service's offers.Service.Accept).
type RideAssigned struct {
	RideRequestID string `json:"ride_request_id"`
	DriverID      string `json:"driver_id"`
	CustomerID    string `json:"customer_id"`
}

// RideUnavailable is the `data` payload of a ride.unavailable.v1 event
// (apps/dispatch-service's matching.Matcher.markUnavailable). Deliberately
// does not carry customer_id — see docs/decisions/0006 — so
// realtime-gateway resolves it from its own RideRequested-derived mapping.
type RideUnavailable struct {
	RideRequestID string `json:"ride_request_id"`
}

// DriverLocationValidated is the `data` payload of a
// driver.location.validated.v1 event (apps/location-service).
type DriverLocationValidated struct {
	DriverID   string    `json:"driver_id"`
	Latitude   float64   `json:"latitude"`
	Longitude  float64   `json:"longitude"`
	RecordedAt time.Time `json:"recorded_at"`
}
