// Package validation implements every GPS-update validation rule from the
// platform brief as small, pure, independently-testable functions, composed
// by Validator.Validate into a single pass/reject decision.
package validation

import (
	"time"

	"location-service/internal/gps"
)

type Config struct {
	MaxAccuracyMeters   float64
	MaxTimestampAge     time.Duration
	MaxFutureSkew       time.Duration
	MaxPlausibleSpeedMS float64
}

type Validator struct {
	cfg Config
}

func New(cfg Config) *Validator {
	return &Validator{cfg: cfg}
}

// Validate runs every check and returns the first failure, or nil if the
// update is accepted. Order matters only for which single reason is
// reported when multiple checks would fail — cheap, payload-only checks run
// before checks that need prior state (last-known position/sequence).
func (v *Validator) Validate(device gps.Device, update gps.Update, last *gps.LastState, now time.Time) *gps.Rejection {
	if r := v.validateDeviceStatus(device); r != nil {
		return r
	}
	if r := v.validateLatLng(update); r != nil {
		return r
	}
	if r := v.validateAccuracy(update); r != nil {
		return r
	}
	if r := v.validateTimestamp(update, now); r != nil {
		return r
	}
	if r := v.validateSequence(last, update); r != nil {
		return r
	}
	if r := v.validateMovement(last, update); r != nil {
		return r
	}
	return nil
}

func (v *Validator) validateDeviceStatus(device gps.Device) *gps.Rejection {
	if device.DeviceStatus != "active" {
		return &gps.Rejection{Reason: gps.ReasonDeviceDisabled, Message: "device is not active"}
	}
	if device.DriverStatus != "active" {
		return &gps.Rejection{Reason: gps.ReasonDriverDisabled, Message: "driver is not active"}
	}
	if device.VehicleStatus == nil || *device.VehicleStatus != "active" {
		return &gps.Rejection{Reason: gps.ReasonVehicleDisabled, Message: "driver has no active vehicle"}
	}
	return nil
}

func (v *Validator) validateLatLng(update gps.Update) *gps.Rejection {
	if update.Latitude < -90 || update.Latitude > 90 {
		return &gps.Rejection{Reason: gps.ReasonInvalidLatitude, Message: "latitude out of range"}
	}
	if update.Longitude < -180 || update.Longitude > 180 {
		return &gps.Rejection{Reason: gps.ReasonInvalidLongitude, Message: "longitude out of range"}
	}
	return nil
}

func (v *Validator) validateAccuracy(update gps.Update) *gps.Rejection {
	if update.AccuracyMeters <= 0 || update.AccuracyMeters > v.cfg.MaxAccuracyMeters {
		return &gps.Rejection{Reason: gps.ReasonInvalidAccuracy, Message: "accuracy_meters outside acceptable range"}
	}
	return nil
}

func (v *Validator) validateTimestamp(update gps.Update, now time.Time) *gps.Rejection {
	age := now.Sub(update.RecordedAt)

	if age > v.cfg.MaxTimestampAge {
		return &gps.Rejection{Reason: gps.ReasonStaleTimestamp, Message: "recorded_at is too old"}
	}
	if age < -v.cfg.MaxFutureSkew {
		return &gps.Rejection{Reason: gps.ReasonFutureTimestamp, Message: "recorded_at is in the future"}
	}
	return nil
}

// validateSequence enforces strictly increasing sequence numbers per
// driver+device. No prior state means this is the first update seen (since
// this Redis key was last empty/expired) and always passes.
func (v *Validator) validateSequence(last *gps.LastState, update gps.Update) *gps.Rejection {
	if last == nil {
		return nil
	}
	if update.Sequence == last.Sequence {
		return &gps.Rejection{Reason: gps.ReasonDuplicateSequence, Message: "duplicate sequence number"}
	}
	if update.Sequence < last.Sequence {
		return &gps.Rejection{Reason: gps.ReasonOutOfOrder, Message: "sequence number older than last accepted update"}
	}
	return nil
}

// validateMovement rejects updates that imply an impossible speed between
// the last accepted position and this one — this is also how "impossible
// geographic jumps" are detected: a huge jump in a short time is exactly a
// huge implied speed, so one physics-based check covers both brief items.
func (v *Validator) validateMovement(last *gps.LastState, update gps.Update) *gps.Rejection {
	if last == nil {
		return nil
	}

	elapsed := update.RecordedAt.Sub(last.RecordedAt).Seconds()
	if elapsed <= 0 {
		// Already caught by validateSequence in practice (a non-increasing
		// sequence implies non-increasing time for a well-behaved client),
		// but guard against div-by-zero/negative for a client that somehow
		// sends increasing sequence numbers with a non-increasing clock.
		return &gps.Rejection{Reason: gps.ReasonOutOfOrder, Message: "recorded_at did not advance from last accepted update"}
	}

	distance := haversineDistanceMeters(last.Latitude, last.Longitude, update.Latitude, update.Longitude)
	impliedSpeed := distance / elapsed

	if impliedSpeed > v.cfg.MaxPlausibleSpeedMS {
		return &gps.Rejection{Reason: gps.ReasonImpossibleSpeed, Message: "implied speed exceeds plausible maximum"}
	}
	return nil
}
