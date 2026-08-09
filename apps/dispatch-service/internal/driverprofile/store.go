// Package driverprofile provides read-only Postgres lookups against the
// dispatch_service role's SELECT grants (drivers, vehicles, driver_devices,
// ride_requests — see
// apps/core-api/database/migrations/2026_08_09_100000_create_dispatch_service_role.php).
// Wrapped in internal/ttlcache by NewCached so the matching hot path
// doesn't hit Postgres once per candidate per ride request.
package driverprofile

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"dispatch-service/internal/types"
)

var ErrNotFound = errors.New("not found")

type Profile struct {
	ID              int64
	UUID            string
	Status          string
	Rating          float64 // defaults to a neutral 3.0 if the driver has no rating yet
	AcceptanceRate  float64 // defaults to a neutral 0.8 if the driver has none yet
	VehicleType     *string // nil if no active vehicle
	RegionID        string
	LastAvailableAt *time.Time
}

type RideRequestRef struct {
	ID                   int64
	UUID                 string
	Status               string
	RegionID             string
	PickupLat            float64
	PickupLng            float64
	RequestedVehicleType string
}

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("driverprofile: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("driverprofile: ping: %w", err)
	}
	return pool, nil
}

// GetDriverProfile resolves a driver's public UUID (as carried on Kafka
// events and in the geo-index) to their internal id plus the ranking/
// filtering inputs matching needs: status, rating, acceptance rate, and
// active vehicle type.
func (s *Store) GetDriverProfile(ctx context.Context, driverUUID string) (*Profile, error) {
	const query = `
		SELECT
			d.id, d.uuid, d.status,
			COALESCE(d.rating, 3.0) AS rating,
			COALESCE(d.acceptance_rate, 0.8) AS acceptance_rate,
			d.region_id, d.last_available_at,
			v.vehicle_type
		FROM drivers d
		LEFT JOIN vehicles v ON v.driver_id = d.id AND v.is_active = true
		WHERE d.uuid = $1
	`

	var p Profile
	row := s.pool.QueryRow(ctx, query, driverUUID)
	err := row.Scan(&p.ID, &p.UUID, &p.Status, &p.Rating, &p.AcceptanceRate, &p.RegionID, &p.LastAvailableAt, &p.VehicleType)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("driverprofile: get driver: %w", err)
	}
	return &p, nil
}

// GetRideRequest resolves a ride request's public UUID to its internal id
// and current status — used both to guard against redelivery/already-
// resolved requests, and to satisfy ride_offers.ride_request_id's bigint FK.
func (s *Store) GetRideRequest(ctx context.Context, rideRequestUUID string) (*RideRequestRef, error) {
	const query = `
		SELECT
			id, uuid, status, region_id, requested_vehicle_type,
			ST_Y(pickup_location::geometry) AS pickup_lat,
			ST_X(pickup_location::geometry) AS pickup_lng
		FROM ride_requests
		WHERE uuid = $1
	`

	var r RideRequestRef
	row := s.pool.QueryRow(ctx, query, rideRequestUUID)
	err := row.Scan(&r.ID, &r.UUID, &r.Status, &r.RegionID, &r.RequestedVehicleType, &r.PickupLat, &r.PickupLng)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("driverprofile: get ride request: %w", err)
	}
	return &r, nil
}

// LookupDeviceByTokenHash authenticates the accept/reject HTTP endpoints —
// the exact same device-token credential and hashing scheme
// apps/location-service uses (see AGENTS.md: device credentials are
// distinct from a driver's core-api user session).
func (s *Store) LookupDeviceByTokenHash(ctx context.Context, tokenHash string) (types.Device, error) {
	const query = `
		SELECT dd.uuid::text, dd.status, d.uuid::text, d.status
		FROM driver_devices dd
		JOIN drivers d ON d.id = dd.driver_id
		WHERE dd.token_hash = $1
	`

	var device types.Device
	row := s.pool.QueryRow(ctx, query, tokenHash)
	err := row.Scan(&device.DeviceID, &device.DeviceStatus, &device.DriverID, &device.DriverStatus)
	if errors.Is(err, pgx.ErrNoRows) {
		return types.Device{}, ErrNotFound
	}
	if err != nil {
		return types.Device{}, fmt.Errorf("driverprofile: lookup device: %w", err)
	}
	return device, nil
}
