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

func patchJSON(url, bearer string, body any) error {
	payload, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal request: %w", err)
	}

	req, err := http.NewRequest(http.MethodPatch, url, bytes.NewReader(payload))
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+bearer)

	resp, err := sharedClient.Do(req)
	if err != nil {
		return fmt.Errorf("request: %w", err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	if resp.StatusCode >= 300 {
		return fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return nil
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

// --- core-api response shapes (only the fields this tool needs) ---

type registerResponse struct {
	Data struct {
		ID     string `json:"id"`
		Driver *struct {
			ID string `json:"id"`
		} `json:"driver"`
		Customer *struct {
			ID string `json:"id"`
		} `json:"customer"`
	} `json:"data"`
	Meta struct {
		Token string `json:"token"`
	} `json:"meta"`
}

type vehicleResponse struct {
	Data struct {
		ID string `json:"id"`
	} `json:"data"`
}

type deviceResponse struct {
	Data struct {
		ID string `json:"id"`
	} `json:"data"`
	Meta struct {
		DeviceToken string `json:"device_token"`
	} `json:"meta"`
}

type rideRequestResponse struct {
	Data struct {
		ID string `json:"id"`
	} `json:"data"`
}
