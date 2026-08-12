package main

import (
	"fmt"
	"math/rand"
	"os/exec"
	"strings"
	"sync"
)

// vehicleType is fixed across every seeded driver and every ride request
// this tool creates — matching-eligibility needs vehicle_type equality
// (see apps/dispatch-service/internal/matching), and a single shared type
// keeps the load scenario simple to reason about. Vary it by hand if you
// specifically want to measure cross-vehicle-type filtering cost.
const vehicleType = "sedan"

type driver struct {
	userUUID    string
	driverUUID  string
	deviceUUID  string
	userToken   string
	deviceToken string
	lat, lng    float64
}

type customer struct {
	userUUID string
	token    string
}

// seedDrivers registers n drivers, each with one active vehicle and one
// device, scattered within roughly a 2km box around (baseLat, baseLng) —
// tight enough that geohash precision 6's center-cell-plus-8-neighbors
// search (see docs/decisions/0005) actually finds them as candidates.
func seedDrivers(cfg config, n int) ([]driver, error) {
	drivers := make([]driver, n)
	errs := make([]error, n)

	var wg sync.WaitGroup
	sem := make(chan struct{}, cfg.seedConcurrency)

	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()
			d, err := seedOneDriver(cfg, i)
			if err != nil {
				errs[i] = err
				return
			}
			drivers[i] = d
		}(i)
	}
	wg.Wait()

	var out []driver
	failed := 0
	for i, d := range drivers {
		if errs[i] != nil {
			failed++
			continue
		}
		out = append(out, d)
	}
	if failed > 0 {
		fmt.Printf("  ! %d/%d driver seeds failed (first error: %v)\n", failed, n, firstErr(errs))
	}
	return out, nil
}

func seedOneDriver(cfg config, i int) (driver, error) {
	email := fmt.Sprintf("loadtest-driver-%d-%d@test.local", cfg.runID, i)
	var reg registerResponse
	err := postJSON(cfg.coreAPI+"/api/v1/auth/register", "", map[string]any{
		"name":                  fmt.Sprintf("Load Test Driver %d", i),
		"email":                 email,
		"password":              "password123",
		"password_confirmation": "password123",
		"role":                  "driver",
		"license_number":        fmt.Sprintf("LOADTEST-%d-%d", cfg.runID, i),
		"license_expires_at":    "2030-01-01",
	}, &reg)
	if err != nil {
		return driver{}, fmt.Errorf("register: %w", err)
	}
	if reg.Data.Driver == nil {
		return driver{}, fmt.Errorf("register: no driver profile in response")
	}

	var veh vehicleResponse
	err = postJSON(cfg.coreAPI+"/api/v1/drivers/vehicles", reg.Meta.Token, map[string]any{
		"make":         "Toyota",
		"model":        "Camry",
		"year":         2022,
		"color":        "white",
		"plate_number": fmt.Sprintf("LOAD-%d-%d", cfg.runID, i),
		"vehicle_type": vehicleType,
	}, &veh)
	if err != nil {
		return driver{}, fmt.Errorf("create vehicle: %w", err)
	}

	var dev deviceResponse
	err = postJSON(cfg.coreAPI+"/api/v1/driver/devices", reg.Meta.Token, map[string]any{
		"device_identifier": fmt.Sprintf("loadtest-device-%d-%d", cfg.runID, i),
		"platform":          "android",
	}, &dev)
	if err != nil {
		return driver{}, fmt.Errorf("create device: %w", err)
	}

	if err := patchJSON(cfg.coreAPI+"/api/v1/driver/availability", reg.Meta.Token, map[string]any{"is_available": true}); err != nil {
		return driver{}, fmt.Errorf("set availability: %w", err)
	}

	lat, lng := jitter(cfg.baseLat, cfg.baseLng)
	return driver{
		userUUID:    reg.Data.ID,
		driverUUID:  reg.Data.Driver.ID,
		deviceUUID:  dev.Data.ID,
		userToken:   reg.Meta.Token,
		deviceToken: dev.Meta.DeviceToken,
		lat:         lat,
		lng:         lng,
	}, nil
}

func seedCustomers(cfg config, n int) ([]customer, error) {
	customers := make([]customer, n)
	errs := make([]error, n)

	var wg sync.WaitGroup
	sem := make(chan struct{}, cfg.seedConcurrency)

	for i := 0; i < n; i++ {
		wg.Add(1)
		sem <- struct{}{}
		go func(i int) {
			defer wg.Done()
			defer func() { <-sem }()

			email := fmt.Sprintf("loadtest-customer-%d-%d@test.local", cfg.runID, i)
			var reg registerResponse
			err := postJSON(cfg.coreAPI+"/api/v1/auth/register", "", map[string]any{
				"name":                  fmt.Sprintf("Load Test Customer %d", i),
				"email":                 email,
				"password":              "password123",
				"password_confirmation": "password123",
				"role":                  "customer",
			}, &reg)
			if err != nil {
				errs[i] = fmt.Errorf("register: %w", err)
				return
			}
			customers[i] = customer{userUUID: reg.Data.ID, token: reg.Meta.Token}
		}(i)
	}
	wg.Wait()

	var out []customer
	failed := 0
	for i, c := range customers {
		if errs[i] != nil {
			failed++
			continue
		}
		out = append(out, c)
	}
	if failed > 0 {
		fmt.Printf("  ! %d/%d customer seeds failed (first error: %v)\n", failed, n, firstErr(errs))
	}
	return out, nil
}

// activateDrivers bypasses the (not-yet-built, see contracts/postman/README.md's
// documented gap) admin-approval flow the same way this repo's own manual
// verification steps already do: a direct UPDATE, shelled out through
// `docker compose exec postgres psql` so this tool needs no Postgres
// driver dependency of its own — same pattern scripts/kafka-replay-dlq.sh
// already uses for the Kafka CLI.
func activateDrivers(cfg config, drivers []driver) error {
	if len(drivers) == 0 {
		return nil
	}

	uuids := make([]string, len(drivers))
	for i, d := range drivers {
		uuids[i] = "'" + d.driverUUID + "'"
	}
	sql := fmt.Sprintf("UPDATE drivers SET status = 'active' WHERE uuid IN (%s);", strings.Join(uuids, ","))

	cmd := exec.Command("docker", "compose", "exec", "-T", "postgres", "psql", "-U", "core_api", "-d", "core_api", "-c", sql)
	cmd.Dir = cfg.repoRoot
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("activate drivers: %w (output: %s)", err, string(output))
	}
	return nil
}

// jitter scatters a point within roughly +/-1km of the base — small
// enough that geohash precision 6's 9-cell search (center + 8 neighbors,
// ~3.6km x 1.8km total) reliably covers it.
func jitter(baseLat, baseLng float64) (float64, float64) {
	const degreesPerKm = 0.009 // ~1km at this latitude
	dLat := (rand.Float64()*2 - 1) * degreesPerKm
	dLng := (rand.Float64()*2 - 1) * degreesPerKm
	return baseLat + dLat, baseLng + dLng
}

func firstErr(errs []error) error {
	for _, e := range errs {
		if e != nil {
			return e
		}
	}
	return nil
}
