package driverprofile

import (
	"context"
	"errors"
	"time"

	"dispatch-service/internal/ttlcache"
	"dispatch-service/internal/types"
)

type profileResult struct {
	profile *Profile
	err     error
}

type deviceResult struct {
	device types.Device
	err    error
}

// CachedStore wraps Store with short-TTL caches for the two lookups the
// matching hot path and HTTP auth middleware call frequently. Ride request
// lookups are NOT cached — they happen at most once per matching cycle
// (not once per candidate), so the cost/benefit doesn't justify it.
type CachedStore struct {
	store    *Store
	Profiles *ttlcache.Cache[string, profileResult]
	Devices  *ttlcache.Cache[string, deviceResult]
}

func NewCached(store *Store, ttl time.Duration) *CachedStore {
	return &CachedStore{
		store:    store,
		Profiles: ttlcache.New[string, profileResult](ttl),
		Devices:  ttlcache.New[string, deviceResult](ttl),
	}
}

func (c *CachedStore) GetDriverProfile(ctx context.Context, driverUUID string) (*Profile, error) {
	if cached, ok := c.Profiles.Get(driverUUID); ok {
		return cached.profile, cached.err
	}

	profile, err := c.store.GetDriverProfile(ctx, driverUUID)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return nil, err // transient errors (DB down) are never cached
	}

	c.Profiles.Set(driverUUID, profileResult{profile: profile, err: err})
	return profile, err
}

func (c *CachedStore) LookupDeviceByTokenHash(ctx context.Context, tokenHash string) (types.Device, error) {
	if cached, ok := c.Devices.Get(tokenHash); ok {
		return cached.device, cached.err
	}

	device, err := c.store.LookupDeviceByTokenHash(ctx, tokenHash)
	if err != nil && !errors.Is(err, ErrNotFound) {
		return types.Device{}, err
	}

	c.Devices.Set(tokenHash, deviceResult{device: device, err: err})
	return device, err
}

// GetRideRequest is intentionally not cached — see type doc comment.
func (c *CachedStore) GetRideRequest(ctx context.Context, rideRequestUUID string) (*RideRequestRef, error) {
	return c.store.GetRideRequest(ctx, rideRequestUUID)
}
