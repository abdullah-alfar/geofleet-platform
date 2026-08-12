package main

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strconv"
)

// vehicleType is fixed across every seeded driver and every ride request
// this tool creates — matching-eligibility needs vehicle_type equality
// (see apps/dispatch-service/internal/matching), and a single shared type
// keeps the load scenario simple to reason about. Vary it by hand if you
// specifically want to measure cross-vehicle-type filtering cost.
const vehicleType = "sedan"

type driver struct {
	driverUUID  string
	deviceUUID  string
	deviceToken string
	lat, lng    float64
}

type customer struct {
	customerUUID string
	token        string
}

type seedOutput struct {
	Drivers []struct {
		DriverUUID  string  `json:"driver_uuid"`
		DeviceUUID  string  `json:"device_uuid"`
		DeviceToken string  `json:"device_token"`
		Lat         float64 `json:"lat"`
		Lng         float64 `json:"lng"`
	} `json:"drivers"`
	Customers []struct {
		CustomerUUID string `json:"customer_uuid"`
		Token        string `json:"token"`
	} `json:"customers"`
}

// seedFleet provisions n drivers and m customers via core-api's
// `loadtest:seed` artisan command — not the public HTTP registration
// endpoint, which is deliberately rate-limited to 10/minute per IP
// (brute-force/enumeration protection, see AppServiceProvider's `auth`
// limiter) and therefore the wrong tool for bulk test-data provisioning.
// See docs/decisions/0008-load-testing-approach.md. Drivers come back
// already active (bypassing the not-yet-built admin approval step) and
// scattered within ~1km of (baseLat, baseLng) — see LoadTestSeed.php's
// jitterPoint, which matches this tool's own jitter().
func seedFleet(cfg config, driverCount, customerCount int) ([]driver, []customer, error) {
	cmd := exec.Command("php", "artisan", "loadtest:seed",
		"--drivers="+strconv.Itoa(driverCount),
		"--customers="+strconv.Itoa(customerCount),
		"--base-lat="+strconv.FormatFloat(cfg.baseLat, 'f', -1, 64),
		"--base-lng="+strconv.FormatFloat(cfg.baseLng, 'f', -1, 64),
		"--run-id="+strconv.FormatInt(cfg.runID, 10),
	)
	cmd.Dir = cfg.coreAPIDir

	output, err := cmd.Output()
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			return nil, nil, fmt.Errorf("loadtest:seed failed: %w (stderr: %s)", err, string(exitErr.Stderr))
		}
		return nil, nil, fmt.Errorf("run loadtest:seed: %w", err)
	}

	var parsed seedOutput
	if err := json.Unmarshal(output, &parsed); err != nil {
		return nil, nil, fmt.Errorf("decode loadtest:seed output: %w (output: %s)", err, truncate(string(output), 500))
	}

	drivers := make([]driver, len(parsed.Drivers))
	for i, d := range parsed.Drivers {
		drivers[i] = driver{
			driverUUID:  d.DriverUUID,
			deviceUUID:  d.DeviceUUID,
			deviceToken: d.DeviceToken,
			lat:         d.Lat,
			lng:         d.Lng,
		}
	}

	customers := make([]customer, len(parsed.Customers))
	for i, c := range parsed.Customers {
		customers[i] = customer{customerUUID: c.CustomerUUID, token: c.Token}
	}

	return drivers, customers, nil
}
