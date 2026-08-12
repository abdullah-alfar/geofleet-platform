package main

import (
	"sync"
	"sync/atomic"
)

type rideRunResult struct {
	created int64
	failed  int64
}

// runRideRequestBurst has every customer create one ride request as close
// to simultaneously as this tool's own concurrency allows — the scenario
// this exercises is dispatch-service's matching cycle (candidate search,
// ranking, offer creation) under a burst of concurrent demand, not
// creation throughput on core-api's side (that's a much simpler,
// less interesting write path). Pickup points are jittered close to the
// seeded drivers' own positions so matches are actually possible; a
// customer whose randomly-jittered pickup lands outside every driver's
// geohash search radius will legitimately end up `unavailable`, which the
// system already handles (see docs/decisions/0005) — not a bug in this
// tool, just a reminder that this is a probabilistic scenario, not a
// synthetic guaranteed-match one.
func runRideRequestBurst(cfg config, customers []customer, drivers []driver) rideRunResult {
	var result rideRunResult
	var wg sync.WaitGroup
	sem := make(chan struct{}, cfg.rideBurstConcurrency)

	for i, c := range customers {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int, c customer) {
			defer wg.Done()
			defer func() { <-sem }()

			// Center each ride request's pickup near a driver (round-robin
			// across the seeded fleet) rather than the shared base point —
			// spreads pickups across the same area drivers are actually
			// scattered in, instead of clustering unrealistically on one
			// exact coordinate.
			anchor := drivers[i%len(drivers)]
			pickupLat, pickupLng := jitter(anchor.lat, anchor.lng)
			dropoffLat, dropoffLng := jitter(cfg.baseLat, cfg.baseLng)

			var resp rideRequestResponse
			err := postJSON(cfg.coreAPI+"/api/v1/ride-requests", c.token, map[string]any{
				"pickup_lat":             pickupLat,
				"pickup_lng":             pickupLng,
				"dropoff_lat":            dropoffLat,
				"dropoff_lng":            dropoffLng,
				"requested_vehicle_type": vehicleType,
			}, &resp)
			if err != nil {
				atomic.AddInt64(&result.failed, 1)
				return
			}
			atomic.AddInt64(&result.created, 1)
		}(i, c)
	}
	wg.Wait()
	return result
}
