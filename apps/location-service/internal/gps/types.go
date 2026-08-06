// Package gps defines the types shared across location-service's internal
// packages (HTTP layer, validation, storage, publishing) so none of them
// need to import each other just to agree on a shape.
package gps

import "time"

// Update is a single GPS ping as received from a driver device, matching
// the JSON schema in the platform brief.
type Update struct {
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

// Device is the authenticated identity behind a request: the device itself,
// its owning driver, and that driver's currently active vehicle (if any).
// Populated from Postgres (via devicestore, through devicecache) — never
// trust identity fields on the inbound Update payload itself.
type Device struct {
	DeviceID      string
	DeviceStatus  string // driver_devices.status
	DriverID      string
	DriverStatus  string // drivers.status
	RegionID      string
	VehicleStatus *string // nil if the driver has no active vehicle
}

// LastState is the last accepted update for a driver, used by the
// validation pipeline to detect duplicate/out-of-order sequences and
// physically-impossible movement. Stored in Redis so it's consistent across
// multiple location-service instances (see internal/redisstore).
type LastState struct {
	Sequence   int64     `json:"sequence"`
	Latitude   float64   `json:"latitude"`
	Longitude  float64   `json:"longitude"`
	RecordedAt time.Time `json:"recorded_at"`
}

// RejectionReason is a stable, machine-readable code for why a GPS update
// was not accepted — used in the HTTP response and as a metrics label.
type RejectionReason string

const (
	ReasonInvalidLatitude   RejectionReason = "invalid_latitude"
	ReasonInvalidLongitude  RejectionReason = "invalid_longitude"
	ReasonInvalidAccuracy   RejectionReason = "invalid_accuracy"
	ReasonStaleTimestamp    RejectionReason = "stale_timestamp"
	ReasonFutureTimestamp   RejectionReason = "future_timestamp"
	ReasonDuplicateSequence RejectionReason = "duplicate_sequence"
	ReasonOutOfOrder        RejectionReason = "out_of_order_sequence"
	ReasonImpossibleSpeed   RejectionReason = "impossible_speed"
	ReasonDriverDisabled    RejectionReason = "driver_disabled"
	ReasonVehicleDisabled   RejectionReason = "vehicle_disabled"
	ReasonDeviceDisabled    RejectionReason = "device_disabled"
	ReasonRateLimited       RejectionReason = "rate_limited"
)

// Rejection carries why an update was rejected, for both the HTTP response
// and structured logging.
type Rejection struct {
	Reason  RejectionReason
	Message string
}

func (r *Rejection) Error() string {
	return r.Message
}
