// Package redisstore holds location-service's Redis-backed state: the
// latest accepted location per driver (used both as validation input for
// duplicate/out-of-order/speed checks, and as the durable "latest location"
// the brief calls for), plus a rate limiter for excessive update frequency.
//
// Geo-cell (H3) membership is deliberately NOT built here — the brief
// assigns that to dispatch-service (Phase 5), which will consume
// driver.location.validated.v1 to build its own index. A Redis GEO sorted
// set doesn't support per-member TTL, so maintaining one here would risk
// leaving stale entries for offline drivers with no clean way to expire
// them — better left to whichever service actually owns the indexing
// design.
package redisstore

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"location-service/internal/gps"
)

type Store struct {
	client              *redis.Client
	locationTTL         time.Duration
	rateLimitWindow     time.Duration
	maxUpdatesPerWindow int
}

func New(client *redis.Client, locationTTL, rateLimitWindow time.Duration, maxUpdatesPerWindow int) *Store {
	return &Store{
		client:              client,
		locationTTL:         locationTTL,
		rateLimitWindow:     rateLimitWindow,
		maxUpdatesPerWindow: maxUpdatesPerWindow,
	}
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
		return nil, fmt.Errorf("redisstore: ping: %w", err)
	}
	return client, nil
}

func latestKey(driverID string) string {
	return "location:latest:" + driverID
}

func rateLimitKey(driverID string) string {
	return "location:ratelimit:" + driverID
}

// GetLastState returns the last accepted update for a driver, or nil if
// none is on record (first update ever, or the key expired from
// inactivity) — a nil result is not an error, it just means the
// sequence/movement checks in internal/validation have nothing to compare
// against yet.
func (s *Store) GetLastState(ctx context.Context, driverID string) (*gps.LastState, error) {
	raw, err := s.client.Get(ctx, latestKey(driverID)).Result()
	if errors.Is(err, redis.Nil) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("redisstore: get last state: %w", err)
	}

	var state gps.LastState
	if err := json.Unmarshal([]byte(raw), &state); err != nil {
		return nil, fmt.Errorf("redisstore: decode last state: %w", err)
	}
	return &state, nil
}

// stored is the full record kept in Redis for a driver's latest location —
// a superset of gps.LastState (which only needs sequence/position/time for
// validation) with the extra fields consumers of "latest location" want.
type stored struct {
	gps.LastState
	AccuracyMeters float64  `json:"accuracy_meters"`
	SpeedMPS       *float64 `json:"speed_mps,omitempty"`
	HeadingDegrees *float64 `json:"heading_degrees,omitempty"`
	TripID         *string  `json:"trip_id,omitempty"`
}

// SaveLatest persists the accepted update as the driver's current location,
// refreshing the TTL so a driver who stops sending updates naturally drops
// out of "latest location" after locationTTL (the brief's Redis TTL
// retention policy for live location).
func (s *Store) SaveLatest(ctx context.Context, driverID string, update gps.Update) error {
	record := stored{
		LastState: gps.LastState{
			Sequence:   update.Sequence,
			Latitude:   update.Latitude,
			Longitude:  update.Longitude,
			RecordedAt: update.RecordedAt,
		},
		AccuracyMeters: update.AccuracyMeters,
		SpeedMPS:       update.SpeedMPS,
		HeadingDegrees: update.HeadingDegrees,
		TripID:         update.TripID,
	}

	payload, err := json.Marshal(record)
	if err != nil {
		return fmt.Errorf("redisstore: encode latest: %w", err)
	}

	if err := s.client.Set(ctx, latestKey(driverID), payload, s.locationTTL).Err(); err != nil {
		return fmt.Errorf("redisstore: save latest: %w", err)
	}
	return nil
}

// CheckRateLimit implements a fixed-window counter: at most
// maxUpdatesPerWindow accepted calls per rateLimitWindow per driver. Fixed-
// window (not sliding/token-bucket) is a deliberate simplicity choice for
// the MVP — it allows a short burst at window boundaries, which is
// acceptable for this use case (protecting against a malfunctioning client
// hammering the endpoint, not precise traffic shaping).
func (s *Store) CheckRateLimit(ctx context.Context, driverID string) (allowed bool, err error) {
	key := rateLimitKey(driverID)

	count, err := s.client.Incr(ctx, key).Result()
	if err != nil {
		return false, fmt.Errorf("redisstore: rate limit incr: %w", err)
	}

	if count == 1 {
		if err := s.client.Expire(ctx, key, s.rateLimitWindow).Err(); err != nil {
			return false, fmt.Errorf("redisstore: rate limit expire: %w", err)
		}
	}

	return count <= int64(s.maxUpdatesPerWindow), nil
}
