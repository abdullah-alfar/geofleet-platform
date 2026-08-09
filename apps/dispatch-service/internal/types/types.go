// Package types defines the event payload and domain shapes shared across
// dispatch-service's internal packages, so none of them need to import each
// other just to agree on a struct.
package types

import "time"

// RideRequested is the `data` payload of a ride.requested.v1 event (see
// docs/events/topic-catalog.md — produced by core-api's
// RideRequestController::store).
type RideRequested struct {
	RideRequestID        string `json:"ride_request_id"`
	CustomerID           string `json:"customer_id"`
	RegionID             string `json:"region_id"`
	Pickup               LatLng `json:"pickup"`
	Dropoff              LatLng `json:"dropoff"`
	RequestedVehicleType string `json:"requested_vehicle_type"`
}

type LatLng struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

// DriverLocationValidated is the `data` payload of a
// driver.location.validated.v1 event (produced by apps/location-service).
type DriverLocationValidated struct {
	DriverID       string    `json:"driver_id"`
	DeviceID       string    `json:"device_id"`
	TripID         *string   `json:"trip_id"`
	Sequence       int64     `json:"sequence"`
	Latitude       float64   `json:"latitude"`
	Longitude      float64   `json:"longitude"`
	AccuracyMeters float64   `json:"accuracy_meters"`
	SpeedMPS       *float64  `json:"speed_mps"`
	HeadingDegrees *float64  `json:"heading_degrees"`
	RecordedAt     time.Time `json:"recorded_at"`
}

// DriverStatusChanged is the `data` payload of a driver.status.changed.v1
// event (produced by core-api's DriverAvailabilityController).
type DriverStatusChanged struct {
	DriverID    string `json:"driver_id"`
	IsAvailable bool   `json:"is_available"`
}

// Candidate is a driver under consideration for a ride request, after
// geo-cell search, staleness/availability filtering, and vehicle-type
// matching — everything internal/ranking needs to score it.
type Candidate struct {
	DriverID        string
	DistanceMeters  float64
	RatingOrDefault float64
	AcceptanceRate  float64
	IdleSeconds     float64
}

// Device mirrors location-service's identity shape — used by dispatch-
// service's own device-token auth for the accept/reject HTTP endpoints
// (same driver_devices credential, same validation approach).
type Device struct {
	DeviceID     string
	DeviceStatus string
	DriverID     string
	DriverStatus string
}
