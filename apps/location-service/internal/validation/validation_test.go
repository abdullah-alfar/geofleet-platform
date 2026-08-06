package validation

import (
	"testing"
	"time"

	"location-service/internal/gps"
)

func testConfig() Config {
	return Config{
		MaxAccuracyMeters:   100,
		MaxTimestampAge:     120 * time.Second,
		MaxFutureSkew:       10 * time.Second,
		MaxPlausibleSpeedMS: 60,
	}
}

func activeDevice() gps.Device {
	active := "active"
	return gps.Device{
		DeviceID:      "device-1",
		DeviceStatus:  "active",
		DriverID:      "driver-1",
		DriverStatus:  "active",
		RegionID:      "amman",
		VehicleStatus: &active,
	}
}

func baseUpdate(now time.Time) gps.Update {
	return gps.Update{
		DriverID:       "driver-1",
		DeviceID:       "device-1",
		Sequence:       10,
		Latitude:       31.9539,
		Longitude:      35.9106,
		AccuracyMeters: 8.5,
		RecordedAt:     now,
	}
}

func TestValidate_AcceptsWellFormedUpdate(t *testing.T) {
	v := New(testConfig())
	now := time.Now()

	if r := v.Validate(activeDevice(), baseUpdate(now), nil, now); r != nil {
		t.Fatalf("expected acceptance, got rejection: %s", r.Reason)
	}
}

func TestValidate_DeviceStatus(t *testing.T) {
	v := New(testConfig())
	now := time.Now()
	update := baseUpdate(now)

	cases := []struct {
		name   string
		device gps.Device
		want   gps.RejectionReason
	}{
		{"device disabled", withDeviceStatus(activeDevice(), "revoked"), gps.ReasonDeviceDisabled},
		{"driver disabled", withDriverStatus(activeDevice(), "suspended"), gps.ReasonDriverDisabled},
		{"no active vehicle", withNilVehicle(activeDevice()), gps.ReasonVehicleDisabled},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := v.Validate(tc.device, update, nil, now)
			if r == nil || r.Reason != tc.want {
				t.Fatalf("expected reason %s, got %v", tc.want, r)
			}
		})
	}
}

func TestValidate_LatLngRange(t *testing.T) {
	v := New(testConfig())
	now := time.Now()

	tooFarNorth := baseUpdate(now)
	tooFarNorth.Latitude = 91

	tooFarEast := baseUpdate(now)
	tooFarEast.Longitude = 181

	if r := v.Validate(activeDevice(), tooFarNorth, nil, now); r == nil || r.Reason != gps.ReasonInvalidLatitude {
		t.Fatalf("expected invalid_latitude, got %v", r)
	}
	if r := v.Validate(activeDevice(), tooFarEast, nil, now); r == nil || r.Reason != gps.ReasonInvalidLongitude {
		t.Fatalf("expected invalid_longitude, got %v", r)
	}
}

func TestValidate_Accuracy(t *testing.T) {
	v := New(testConfig())
	now := time.Now()

	bad := baseUpdate(now)
	bad.AccuracyMeters = 500 // worse than the 100m ceiling

	if r := v.Validate(activeDevice(), bad, nil, now); r == nil || r.Reason != gps.ReasonInvalidAccuracy {
		t.Fatalf("expected invalid_accuracy, got %v", r)
	}
}

func TestValidate_StaleAndFutureTimestamps(t *testing.T) {
	v := New(testConfig())
	now := time.Now()

	stale := baseUpdate(now.Add(-5 * time.Minute))
	future := baseUpdate(now.Add(1 * time.Minute))

	if r := v.Validate(activeDevice(), stale, nil, now); r == nil || r.Reason != gps.ReasonStaleTimestamp {
		t.Fatalf("expected stale_timestamp, got %v", r)
	}
	if r := v.Validate(activeDevice(), future, nil, now); r == nil || r.Reason != gps.ReasonFutureTimestamp {
		t.Fatalf("expected future_timestamp, got %v", r)
	}
}

func TestValidate_DuplicateAndOutOfOrderSequence(t *testing.T) {
	v := New(testConfig())
	now := time.Now()

	last := &gps.LastState{Sequence: 10, Latitude: 31.9539, Longitude: 35.9106, RecordedAt: now.Add(-5 * time.Second)}

	duplicate := baseUpdate(now)
	duplicate.Sequence = 10

	outOfOrder := baseUpdate(now)
	outOfOrder.Sequence = 9

	if r := v.Validate(activeDevice(), duplicate, last, now); r == nil || r.Reason != gps.ReasonDuplicateSequence {
		t.Fatalf("expected duplicate_sequence, got %v", r)
	}
	if r := v.Validate(activeDevice(), outOfOrder, last, now); r == nil || r.Reason != gps.ReasonOutOfOrder {
		t.Fatalf("expected out_of_order_sequence, got %v", r)
	}
}

func TestValidate_ImpossibleSpeed(t *testing.T) {
	v := New(testConfig())
	now := time.Now()

	// Amman to Aqaba (~280km) in 5 seconds — physically impossible.
	last := &gps.LastState{Sequence: 10, Latitude: 31.9539, Longitude: 35.9106, RecordedAt: now.Add(-5 * time.Second)}

	jump := baseUpdate(now)
	jump.Sequence = 11
	jump.Latitude = 29.5321
	jump.Longitude = 35.0063

	if r := v.Validate(activeDevice(), jump, last, now); r == nil || r.Reason != gps.ReasonImpossibleSpeed {
		t.Fatalf("expected impossible_speed, got %v", r)
	}
}

func TestValidate_PlausibleMovementAccepted(t *testing.T) {
	v := New(testConfig())
	now := time.Now()

	// ~50m in 5 seconds (10 m/s / 36 km/h) — well within plausible bounds.
	last := &gps.LastState{Sequence: 10, Latitude: 31.9539, Longitude: 35.9106, RecordedAt: now.Add(-5 * time.Second)}

	nearby := baseUpdate(now)
	nearby.Sequence = 11
	nearby.Latitude = 31.9543
	nearby.Longitude = 35.9106

	if r := v.Validate(activeDevice(), nearby, last, now); r != nil {
		t.Fatalf("expected acceptance, got rejection: %s", r.Reason)
	}
}

func withDeviceStatus(d gps.Device, status string) gps.Device {
	d.DeviceStatus = status
	return d
}

func withDriverStatus(d gps.Device, status string) gps.Device {
	d.DriverStatus = status
	return d
}

func withNilVehicle(d gps.Device) gps.Device {
	d.VehicleStatus = nil
	return d
}
