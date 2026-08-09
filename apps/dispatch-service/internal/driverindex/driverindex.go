// Package driverindex maintains dispatch-service's own Redis-backed index
// of available drivers by geohash cell — built by consuming
// driver.location.validated.v1 and driver.status.changed.v1. This is
// deliberately separate from location-service's "latest location" cache
// (internal/redisstore there): different keys, different owner, different
// purpose (candidate search vs. "what is this driver's current position").
//
// Geocell SET membership can go stale (a driver's hash key can expire, or
// they can go quiet without an explicit offline event, leaving them in a
// cell's SET after they're no longer really reachable). This package does
// not proactively clean that up — see docs/decisions/0005 — candidate
// search always re-checks each member's actual last-updated timestamp
// before treating them as real (internal/matching does this), so a stale
// SET entry is filtered out at read time, never trusted blindly.
package driverindex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"dispatch-service/internal/geohash"
)

type Store struct {
	client    *redis.Client
	precision uint
}

func New(client *redis.Client, precision uint) *Store {
	return &Store{client: client, precision: precision}
}

func Connect(ctx context.Context, addr, password string, commandTimeout time.Duration) (*redis.Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     password,
		DialTimeout:  commandTimeout,
		ReadTimeout:  commandTimeout,
		WriteTimeout: commandTimeout,
	})
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("driverindex: ping: %w", err)
	}
	return client, nil
}

// DriverState is a driver's last-known position/availability as dispatch-
// service has recorded it.
type DriverState struct {
	Latitude    float64   `json:"lat"`
	Longitude   float64   `json:"lng"`
	Geohash     string    `json:"geohash"`
	UpdatedAt   time.Time `json:"updated_at"`
	IsAvailable bool      `json:"available"`
}

func driverKey(driverID string) string {
	return "dispatch:driver:" + driverID
}

func cellKey(cell string) string {
	return "dispatch:geocell:" + cell
}

// UpdateLocation records a driver's new position. If they're currently
// available, their geocell SET membership moves to the new cell in the
// same round trip (a driver who isn't available isn't added to any cell —
// nothing to search for yet).
func (s *Store) UpdateLocation(ctx context.Context, driverID string, lat, lng float64, recordedAt time.Time) error {
	prior, err := s.GetDriverState(ctx, driverID)
	if err != nil {
		return err
	}

	newCell := geohash.Cell(lat, lng, s.precision)

	state := DriverState{
		Latitude:    lat,
		Longitude:   lng,
		Geohash:     newCell,
		UpdatedAt:   recordedAt,
		IsAvailable: prior != nil && prior.IsAvailable,
	}

	if err := s.saveState(ctx, driverID, state); err != nil {
		return err
	}

	if !state.IsAvailable {
		return nil
	}

	pipe := s.client.TxPipeline()
	if prior != nil && prior.Geohash != "" && prior.Geohash != newCell {
		pipe.SRem(ctx, cellKey(prior.Geohash), driverID)
	}
	pipe.SAdd(ctx, cellKey(newCell), driverID)
	_, err = pipe.Exec(ctx)
	if err != nil {
		return fmt.Errorf("driverindex: update geocell membership: %w", err)
	}
	return nil
}

// SetAvailability records a driver going online/offline, adding or
// removing them from their current geocell's candidate SET accordingly.
func (s *Store) SetAvailability(ctx context.Context, driverID string, available bool) error {
	prior, err := s.GetDriverState(ctx, driverID)
	if err != nil {
		return err
	}

	state := DriverState{IsAvailable: available}
	if prior != nil {
		state.Latitude = prior.Latitude
		state.Longitude = prior.Longitude
		state.Geohash = prior.Geohash
		state.UpdatedAt = prior.UpdatedAt
	}

	if err := s.saveState(ctx, driverID, state); err != nil {
		return err
	}

	if state.Geohash == "" {
		return nil // no known position yet — nothing to add/remove from a cell
	}

	if available {
		return s.client.SAdd(ctx, cellKey(state.Geohash), driverID).Err()
	}
	return s.client.SRem(ctx, cellKey(state.Geohash), driverID).Err()
}

func (s *Store) saveState(ctx context.Context, driverID string, state DriverState) error {
	payload, err := json.Marshal(state)
	if err != nil {
		return fmt.Errorf("driverindex: encode state: %w", err)
	}
	// Generous TTL relative to matching's own staleness window — this is a
	// backstop against unbounded growth from drivers who vanish without an
	// offline event, not the primary staleness check (see package docs).
	if err := s.client.Set(ctx, driverKey(driverID), payload, 30*time.Minute).Err(); err != nil {
		return fmt.Errorf("driverindex: save state: %w", err)
	}
	return nil
}

func (s *Store) GetDriverState(ctx context.Context, driverID string) (*DriverState, error) {
	raw, err := s.client.Get(ctx, driverKey(driverID)).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("driverindex: get state: %w", err)
	}

	var state DriverState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return nil, fmt.Errorf("driverindex: decode state: %w", err)
	}
	return &state, nil
}

// CandidateDriverIDs returns the union of every driver ID recorded in any
// of the given geohash cells — a coarse candidate set that matching then
// filters (staleness, vehicle type, already-offered) and ranks.
func (s *Store) CandidateDriverIDs(ctx context.Context, cells []string) ([]string, error) {
	keys := make([]string, len(cells))
	for i, c := range cells {
		keys[i] = cellKey(c)
	}

	ids, err := s.client.SUnion(ctx, keys...).Result()
	if err != nil {
		return nil, fmt.Errorf("driverindex: candidate search: %w", err)
	}
	return ids, nil
}
