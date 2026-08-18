// core-api / location-service HTTP client helpers — thin wrappers over the
// same REST endpoints contracts/postman/ and this repo's own manual
// verification steps already use. No mocking: this tool only ever talks
// to the real, running services.
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"math/rand"
	"net/http"
	"time"
)

// sharedClient is used for every HTTP call this tool makes. The default
// http.Client's transport caps idle connections per host at 2, which
// would throttle this tool's own concurrency long before the services
// under test become the bottleneck — this is a load *generator*, so its
// own connection pool needs to be wide open.
var sharedClient = &http.Client{
	Timeout: 10 * time.Second,
	Transport: &http.Transport{
		MaxIdleConns:        1000,
		MaxIdleConnsPerHost: 1000,
		MaxConnsPerHost:     0, // unlimited
	},
}

func getJSON(url, bearer string, out any) error {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}

	resp, err := sharedClient.Do(req)
	if err != nil {
		return fmt.Errorf("request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(respBody), 300))
	}

	if out != nil {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("decode response: %w (body: %s)", err, truncate(string(respBody), 300))
		}
	}
	return nil
}

func postJSON(url, bearer string, body any, out any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if bearer != "" {
		req.Header.Set("Authorization", "Bearer "+bearer)
	}

	resp, err := sharedClient.Do(req)
	if err != nil {
		return fmt.Errorf("request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}

	if resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d: %s", resp.StatusCode, truncate(string(respBody), 300))
	}

	if out != nil {
		if err := json.Unmarshal(respBody, out); err != nil {
			return fmt.Errorf("decode response: %w (body: %s)", err, truncate(string(respBody), 300))
		}
	}
	return nil
}

// jitter scatters a point within roughly +/-1km of (lat, lng) — used for
// ride-request pickup/dropoff points. Matches LoadTestSeed.php's own
// jitterPoint(), which does the equivalent for seeded driver positions.
func jitter(lat, lng float64) (float64, float64) {
	const degreesPerKm = 0.009 // ~1km at this latitude
	dLat := (rand.Float64()*2 - 1) * degreesPerKm
	dLng := (rand.Float64()*2 - 1) * degreesPerKm
	return lat + dLat, lng + dLng
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// rideRequestResponse is the only core-api HTTP response shape this tool
// still decodes — driver/customer provisioning goes through
// `php artisan loadtest:seed` instead (see seed.go), not the HTTP API.
type rideRequestResponse struct {
	Data struct {
		ID string `json:"id"`
	} `json:"data"`
}
