// Command loadtest is a lightweight, dependency-free load generator and
// capacity report for this platform's GPS ingestion and ride-matching
// paths (Phase 8 — see docs/architecture/scalability.md). It talks only
// to real, running services over their real HTTP APIs — no mocking — and
// reads its latency/throughput numbers back out of each service's own
// already-instrumented Prometheus /metrics endpoint rather than
// reimplementing timing client-side. See README.md in this directory for
// usage.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type config struct {
	coreAPI         string
	coreAPIDir      string
	locationService string
	dispatchService string
	realtimeGateway string
	repoRoot        string

	drivers   int
	customers int

	gpsInterval time.Duration
	gpsDuration time.Duration

	seedConcurrency      int
	rideBurstConcurrency int

	baseLat, baseLng float64

	runID int64
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "loadtest:", err)
		os.Exit(1)
	}
}

func run() error {
	cwd, _ := os.Getwd()
	repoRoot := filepath.Join(cwd, "..", "..") // scripts/loadtest -> repo root

	cfg := config{}
	flag.StringVar(&cfg.coreAPI, "core-api", "http://localhost:8002", "core-api base URL")
	flag.StringVar(&cfg.locationService, "location-service", "http://localhost:8081", "location-service base URL")
	flag.StringVar(&cfg.dispatchService, "dispatch-service", "http://localhost:8082", "dispatch-service base URL")
	flag.StringVar(&cfg.realtimeGateway, "realtime-gateway", "http://localhost:8083", "realtime-gateway base URL (optional — skipped if unreachable)")
	flag.StringVar(&cfg.repoRoot, "repo-root", repoRoot, "repository root (for locating apps/core-api to pump the outbox)")
	flag.IntVar(&cfg.drivers, "drivers", 50, "number of synthetic drivers to seed and simulate")
	flag.IntVar(&cfg.customers, "customers", 20, "number of synthetic customers, each creating one ride request")
	flag.DurationVar(&cfg.gpsInterval, "gps-interval", 4*time.Second, "average interval between one driver's GPS pings")
	flag.DurationVar(&cfg.gpsDuration, "gps-duration", 30*time.Second, "how long to run the GPS load phase")
	flag.IntVar(&cfg.seedConcurrency, "seed-concurrency", 20, "max concurrent registration requests while seeding")
	flag.IntVar(&cfg.rideBurstConcurrency, "ride-burst-concurrency", 50, "max concurrent ride-request creations in the burst phase")
	flag.Float64Var(&cfg.baseLat, "base-lat", 31.9539, "base latitude drivers/rides are scattered around (default: Amman)")
	flag.Float64Var(&cfg.baseLng, "base-lng", 35.9106, "base longitude drivers/rides are scattered around (default: Amman)")
	flag.Parse()

	cfg.coreAPIDir = filepath.Join(cfg.repoRoot, "apps", "core-api")
	cfg.runID = time.Now().UnixNano()

	fmt.Printf("=== loadtest run %d: %d drivers, %d customers ===\n\n", cfg.runID, cfg.drivers, cfg.customers)

	services := map[string]string{
		"core-api":         cfg.coreAPI + "/up",
		"location-service": cfg.locationService + "/healthz",
		"dispatch-service": cfg.dispatchService + "/healthz",
	}
	for name, url := range services {
		if err := checkHealthy(url); err != nil {
			return fmt.Errorf("%s not reachable at %s: %w (start it before running this tool)", name, url, err)
		}
	}
	fmt.Println("all required services reachable, proceeding.")

	fmt.Printf("\n--- seeding %d drivers ---\n", cfg.drivers)
	drivers, err := seedDrivers(cfg, cfg.drivers)
	if err != nil {
		return fmt.Errorf("seed drivers: %w", err)
	}
	fmt.Printf("seeded %d/%d drivers\n", len(drivers), cfg.drivers)
	if len(drivers) == 0 {
		return fmt.Errorf("no drivers seeded successfully, aborting")
	}

	if err := activateDrivers(cfg, drivers); err != nil {
		return fmt.Errorf("activate drivers: %w", err)
	}
	fmt.Println("activated all seeded drivers (bypassing the not-yet-built admin approval flow, same as this repo's own manual verification steps)")

	fmt.Println("submitting each driver's initial GPS fix...")
	submitInitialLocations(cfg, drivers)

	fmt.Printf("\n--- seeding %d customers ---\n", cfg.customers)
	customers, err := seedCustomers(cfg, cfg.customers)
	if err != nil {
		return fmt.Errorf("seed customers: %w", err)
	}
	fmt.Printf("seeded %d/%d customers\n", len(customers), cfg.customers)

	// Let the geo-index catch up (Kafka round trip for the initial
	// location fixes) before either load phase starts scoring against it.
	time.Sleep(2 * time.Second)

	before := scrapeAll(cfg)

	fmt.Printf("\n--- GPS load: %d drivers pinging every ~%s for %s ---\n", len(drivers), cfg.gpsInterval, cfg.gpsDuration)
	gpsStart := time.Now()
	gpsResult := runGPSLoad(cfg, drivers, cfg.gpsInterval, cfg.gpsDuration)
	gpsElapsed := time.Since(gpsStart)
	fmt.Printf("GPS phase done: %d sent, %d client-side failures, %.1f req/s (client-observed)\n",
		gpsResult.sent, gpsResult.failed, float64(gpsResult.sent)/gpsElapsed.Seconds())

	fmt.Printf("\n--- ride-request burst: %d customers, concurrency %d ---\n", len(customers), cfg.rideBurstConcurrency)
	pumpCtx, stopPump := context.WithCancel(context.Background())
	go pumpOutbox(pumpCtx, cfg)

	rideStart := time.Now()
	rideResult := runRideRequestBurst(cfg, customers, drivers)
	rideElapsed := time.Since(rideStart)
	fmt.Printf("ride-request burst done: %d created, %d failed, %.1f req/s (client-observed, creation only)\n",
		rideResult.created, rideResult.failed, float64(rideResult.created)/rideElapsed.Seconds())

	// Give the outbox pump + Kafka + dispatch-service's matching cycle
	// time to actually process the burst before scraping metrics and
	// tearing the pump down — otherwise the report undercounts work
	// that's still in flight.
	fmt.Println("draining: letting the outbox publisher and matching pipeline catch up...")
	time.Sleep(8 * time.Second)
	stopPump()

	after := scrapeAll(cfg)

	printReport(before, after, gpsElapsed, rideElapsed)

	return nil
}

func checkHealthy(url string) error {
	client := sharedClient
	resp, err := client.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil
}
