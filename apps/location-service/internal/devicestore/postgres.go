// Package devicestore looks up device/driver/vehicle identity from
// core-api's Postgres, using the least-privilege location_service role
// (SELECT-only on driver_devices, drivers, vehicles — see
// apps/core-api database/migrations/*_create_location_service_role.php).
package devicestore

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"location-service/internal/gps"
)

var ErrNotFound = errors.New("device not found")

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("devicestore: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("devicestore: ping: %w", err)
	}
	return pool, nil
}

// LookupByTokenHash resolves a device credential (SHA-256 hex digest of the
// bearer token — the caller hashes it, this package never sees the raw
// token) to its owning driver and the driver's currently active vehicle, if
// any. Returns ErrNotFound if no device matches — callers must treat that
// as "unknown device" per the brief's validation requirements, not a 500.
func (s *Store) LookupByTokenHash(ctx context.Context, tokenHash string) (gps.Device, error) {
	const query = `
		SELECT
			dd.uuid::text  AS device_uuid,
			dd.status      AS device_status,
			d.uuid::text   AS driver_uuid,
			d.status       AS driver_status,
			d.region_id    AS region_id,
			v.status       AS vehicle_status
		FROM driver_devices dd
		JOIN drivers d ON d.id = dd.driver_id
		LEFT JOIN vehicles v ON v.driver_id = d.id AND v.is_active = true
		WHERE dd.token_hash = $1
		LIMIT 1
	`

	var device gps.Device
	var vehicleStatus *string

	row := s.pool.QueryRow(ctx, query, tokenHash)
	err := row.Scan(
		&device.DeviceID,
		&device.DeviceStatus,
		&device.DriverID,
		&device.DriverStatus,
		&device.RegionID,
		&vehicleStatus,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return gps.Device{}, ErrNotFound
	}
	if err != nil {
		return gps.Device{}, fmt.Errorf("devicestore: lookup: %w", err)
	}

	device.VehicleStatus = vehicleStatus

	return device, nil
}
