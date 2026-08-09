// Package ttlcache is a small generic, short-TTL in-process cache — used to
// protect Postgres from being hit on every candidate lookup in a matching
// cycle, the same pattern apps/location-service uses for device auth
// (internal/devicecache there), generalized over key/value types since
// dispatch-service needs it for two different lookups (driver profiles and
// device auth).
package ttlcache

import (
	"context"
	"sync"
	"time"
)

type entry[V any] struct {
	value     V
	expiresAt time.Time
}

// Cache is constructed once and shared via its pointer — the map is always
// accessed under the mutex, so there is no package-level mutable state.
type Cache[K comparable, V any] struct {
	mu    sync.Mutex
	items map[K]entry[V]
	ttl   time.Duration
}

func New[K comparable, V any](ttl time.Duration) *Cache[K, V] {
	return &Cache[K, V]{items: make(map[K]entry[V]), ttl: ttl}
}

func (c *Cache[K, V]) Get(key K) (V, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	e, ok := c.items[key]
	if !ok || time.Now().After(e.expiresAt) {
		var zero V
		return zero, false
	}
	return e.value, true
}

func (c *Cache[K, V]) Set(key K, value V) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.items[key] = entry[V]{value: value, expiresAt: time.Now().Add(c.ttl)}
}

// Run periodically sweeps expired entries so the cache doesn't grow
// unbounded. See apps/location-service's internal/devicecache for the same
// pattern and the same "good enough for MVP, size-bounded LRU would be a
// Phase 7 hardening item" reasoning.
func (c *Cache[K, V]) Run(ctx context.Context) {
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

func (c *Cache[K, V]) sweep() {
	c.mu.Lock()
	defer c.mu.Unlock()

	now := time.Now()
	for k, e := range c.items {
		if now.After(e.expiresAt) {
			delete(c.items, k)
		}
	}
}
