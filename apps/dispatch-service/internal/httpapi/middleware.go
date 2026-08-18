package httpapi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	"dispatch-service/internal/driverprofile"
	"dispatch-service/internal/metrics"
	"dispatch-service/internal/types"
)

// DriverAuthenticator is the subset of driverprofile.CachedStore this
// package depends on.
type DriverAuthenticator interface {
	LookupDeviceByTokenHash(ctx context.Context, tokenHash string) (types.Device, error)
	GetDriverProfile(ctx context.Context, driverUUID string) (*driverprofile.Profile, error)
}

// corsMiddleware allows browser-based clients (apps/driver-web) to call
// this service directly from a different origin/port — see
// apps/location-service's identical middleware for the full reasoning
// (permissive by design, bearer-device-token authenticated, not
// cookie-based). Must run before the mux does its own routing (see
// server.go's chain ordering) — net/http's ServeMux 405s an OPTIONS
// preflight against a route registered for a specific method.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func correlationMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		correlationID := r.Header.Get("X-Correlation-Id")
		if _, err := uuid.Parse(correlationID); err != nil {
			correlationID = uuid.NewString()
		}

		w.Header().Set("X-Correlation-Id", correlationID)
		ctx := withCorrelationID(r.Context(), correlationID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// driverAuthMiddleware authenticates the same device-token credential
// apps/location-service uses (see AGENTS.md) — no second auth mechanism
// invented for this service.
func driverAuthMiddleware(auth DriverAuthenticator, m *metrics.Metrics, logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token, ok := bearerToken(r)
			if !ok {
				m.AuthFailures.Inc()
				writeError(w, http.StatusUnauthorized, "missing_or_malformed_authorization", "expected 'Authorization: Bearer <device_token>'")
				return
			}

			sum := sha256.Sum256([]byte(token))
			tokenHash := hex.EncodeToString(sum[:])

			device, err := auth.LookupDeviceByTokenHash(r.Context(), tokenHash)
			if errors.Is(err, driverprofile.ErrNotFound) {
				m.AuthFailures.Inc()
				writeError(w, http.StatusUnauthorized, "unknown_device", "device token not recognized")
				return
			}
			if err != nil {
				logger.Error("device lookup failed", "error", err, "correlation_id", correlationIDFromContext(r.Context()))
				writeError(w, http.StatusServiceUnavailable, "device_lookup_unavailable", "could not verify device credentials")
				return
			}
			if device.DeviceStatus != "active" || device.DriverStatus != "active" {
				m.AuthFailures.Inc()
				writeError(w, http.StatusForbidden, "device_or_driver_disabled", "this device or driver account is not active")
				return
			}

			profile, err := auth.GetDriverProfile(r.Context(), device.DriverID)
			if err != nil {
				logger.Error("driver profile lookup failed", "error", err, "correlation_id", correlationIDFromContext(r.Context()))
				writeError(w, http.StatusServiceUnavailable, "driver_lookup_unavailable", "could not load driver profile")
				return
			}

			ctx := withDriver(r.Context(), profile)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func bearerToken(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return "", false
	}
	token := strings.TrimSpace(strings.TrimPrefix(header, prefix))
	if token == "" {
		return "", false
	}
	return token, true
}

func loggingMiddleware(logger *slog.Logger) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rec, r)

			logger.Info("http_request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"duration_ms", time.Since(start).Milliseconds(),
				"correlation_id", correlationIDFromContext(r.Context()),
			)
		})
	}
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

func chain(h http.Handler, mw ...func(http.Handler) http.Handler) http.Handler {
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	return h
}
