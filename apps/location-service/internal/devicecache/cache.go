// Package devicecache wraps devicestore.Store with a short-TTL in-process
// cache so the hot GPS-ingestion path only hits Postgres on a cache miss —
// device/driver/vehicle identity rarely changes within a 30-second window,
// but GPS updates can arrive several times a second per active driver.
package devicecache

import (
	"context"
	"errors"
	"sync"
	"time"

	"location-service/internal/devicestore"
	"location-service/internal/gps"
)

// Lookuper is the subset of devicestore.Store this cache wraps — declared
// here (not imported from devicestore) so the cache only depends on the
// shape it needs, not the whole package.
type Lookuper interface {
	LookupByTokenHash(ctx context.Context, tokenHash string) (gps.Device, error)
}

type entry struct {
	device    gps.Device
	err       error
	expiresAt time.Time
}

// Cache is constructed once (in main.go) and shared via its pointer — the
// map itself is unexported and always accessed under the mutex, so there is
// no package-level mutable state.
type Cache struct {
	mu     sync.Mutex
	items  map[string]entry
	source Lookuper
	ttl    time.Duration
}

func New(source Lookuper, ttl time.Duration) *Cache {
	return &Cache{
		items:  make(map[string]entry),
		source: source,
		ttl:    ttl,
	}
}

func (c *Cache) LookupByTokenHash(ctx context.Context, tokenHash string) (gps.Device, error) {
	if device, err, ok := c.get(tokenHash); ok {
		return device, err
	}

	device, err := c.source.LookupByTokenHash(ctx, tokenHash)
	if err != nil && !errors.Is(err, devicestore.ErrNotFound) {
		// Transient errors (DB unreachable, timeout) are never cached —
		// only stable identity facts (found / not found) are worth
		// remembering across requests.
		return gps.Device{}, err
	}

	c.set(tokenHash, device, err)
	return device, err
}

func (c *Cache) get(tokenHash string) (gps.Device, error, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	e, ok := c.items[tokenHash]
	if !ok || time.Now().After(e.expiresAt) {
		return gps.Device{}, nil, false
	}
	return e.device, e.err, true
}

func (c *Cache) set(tokenHash string, device gps.Device, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.items[tokenHash] = entry{
		device:    device,
		err:       err,
		expiresAt: time.Now().Add(c.ttl),
	}
}

// Run periodically sweeps expired entries so the cache doesn't grow
// unbounded from one-off/invalid tokens. A size-bounded eviction policy
// (LRU) would be a Phase 7 hardening item if this ever becomes a real DoS
// vector — out of scope for the local MVP.
func (c *Cache) Run(ctx context.Context) {
	ticker := time.NewTicker(c.ttl * 2)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.sweep()
		}
	}
}

func (c *Cache) sweep() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for k, e := range c.items {
		if now.After(e.expiresAt) {
			delete(c.items, k)
		}
	}
}
