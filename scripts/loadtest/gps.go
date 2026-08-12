package main

import (
	"fmt"
	"math"
	"math/rand"
	"sync"
	"sync/atomic"
	"time"
)

// simulatedMaxSpeedMS caps this tool's own simulated driving speed —
// deliberately well under location-service's own plausibility threshold
// (MAX_PLAUSIBLE_SPEED_MS, 60 m/s / ~216 km/h default), so a realistic
// walk never trips "impossible_speed" on its own. A driver's position is
// a genuine random walk from ping to ping, not an independent jitter
// around a fixed point each time — the latter implies teleporting, which
// location-service correctly rejects as implausible (see
// internal/validation.validateMovement).
const simulatedMaxSpeedMS = 15.0 // ~54 km/h, reasonable urban driving speed

func sendGPSPing(cfg config, d driver, lat, lng float64, sequence int64) error {
	return postJSON(cfg.locationService+"/v1/locations", d.deviceToken, map[string]any{
		"driver_id":       d.driverUUID,
		"device_id":       d.deviceUUID,
		"latitude":        lat,
		"longitude":       lng,
		"accuracy_meters": 5.0,
		"sequence":        sequence,
		"recorded_at":     time.Now().UTC().Format(time.RFC3339),
	}, nil)
}

// submitInitialLocations gets every driver into dispatch-service's Redis
// geo-index before the timed load phases start — a driver isn't a
// dispatch candidate until at least one validated GPS update has been
// consumed (see apps/dispatch-service/internal/indexconsumers), and
// that's async over Kafka, so this also gives the pipeline a moment to
// catch up. This is each driver's very first ping, so there's no prior
// position to imply a speed against — sent exactly at the seeded
// position, no walk step yet.
func submitInitialLocations(cfg config, drivers []driver) {
	var wg sync.WaitGroup
	sem := make(chan struct{}, cfg.seedConcurrency)
	var failed int64

	for _, d := range drivers {
		wg.Add(1)
		sem <- struct{}{}
		go func(d driver) {
			defer wg.Done()
			defer func() { <-sem }()
			if err := sendGPSPing(cfg, d, d.lat, d.lng, 1); err != nil {
				atomic.AddInt64(&failed, 1)
			}
		}(d)
	}
	wg.Wait()

	if failed > 0 {
		fmt.Printf("  ! %d/%d initial GPS pings failed\n", failed, len(drivers))
	}
}

type gpsRunResult struct {
	sent   int64
	failed int64
}

// runGPSLoad has every driver send a ping roughly every `interval`
// (+/- 20% jitter, like a real device's imperfect timer) for `duration`,
// each ping stepping a bounded random walk from that driver's own
// previous position (see simulatedMaxSpeedMS) — not an independent jitter
// around the origin, which would imply teleporting.
//
// Per-request latency is NOT tracked here — location-service's own
// Prometheus histogram (location_service_ingestion_duration_seconds) is
// the authoritative source for that, scraped before/after this call (see
// metrics.go) rather than duplicated client-side.
func runGPSLoad(cfg config, drivers []driver, interval, duration time.Duration) gpsRunResult {
	var result gpsRunResult
	var wg sync.WaitGroup

	deadline := time.Now().Add(duration)

	for _, d := range drivers {
		wg.Add(1)
		go func(d driver) {
			defer wg.Done()
			var sequence int64 = 2 // 1 was the initial submitInitialLocations ping
			lat, lng := d.lat, d.lng
			lastSent := time.Now()

			for time.Now().Before(deadline) {
				jitteredInterval := time.Duration(float64(interval) * (0.8 + 0.4*rand.Float64()))
				time.Sleep(jitteredInterval)
				if time.Now().After(deadline) {
					return
				}

				elapsed := time.Since(lastSent)
				lat, lng = walkStep(lat, lng, elapsed)
				lastSent = time.Now()

				if err := sendGPSPing(cfg, d, lat, lng, sequence); err != nil {
					atomic.AddInt64(&result.failed, 1)
				} else {
					atomic.AddInt64(&result.sent, 1)
				}
				sequence++
			}
		}(d)
	}
	wg.Wait()
	return result
}

// walkStep moves (lat, lng) a random distance up to simulatedMaxSpeedMS *
// elapsed, in a random direction — a plausible single GPS-fix-to-the-next
// displacement for a driver actually moving, not just noise.
func walkStep(lat, lng float64, elapsed time.Duration) (float64, float64) {
	speed := simulatedMaxSpeedMS * rand.Float64()
	distanceMeters := speed * elapsed.Seconds()
	heading := rand.Float64() * 2 * math.Pi

	const metersPerDegreeLat = 111320.0
	metersPerDegreeLng := metersPerDegreeLat * math.Cos(lat*math.Pi/180)

	dLat := (distanceMeters * math.Cos(heading)) / metersPerDegreeLat
	dLng := (distanceMeters * math.Sin(heading)) / metersPerDegreeLng
	return lat + dLat, lng + dLng
}
