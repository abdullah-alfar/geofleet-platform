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

	"location-service/internal/devicestore"
	"location-service/internal/gps"
	"location-service/internal/metrics"
)

// DeviceAuthenticator is the subset of devicecache.Cache this package
// depends on — declared here so httpapi only depends on the shape it
// needs, not the caching package itself.
type DeviceAuthenticator interface {
	LookupByTokenHash(ctx context.Context, tokenHash string) (gps.Device, error)
}

// corsMiddleware allows browser-based clients (apps/driver-web) to call
// this service directly from a different origin/port — this API predates
// any browser client (only curl and a driver's native mobile app called
// it before), so nothing here handled preflight requests. Permissive by
// design: every route is bearer-device-token authenticated, not
// cookie/session based, so an open Access-Control-Allow-Origin carries no
// more risk than any other public token-authenticated API. Must run
// before the mux does its own routing (see server.go's chain ordering) —
// net/http's ServeMux 405s an OPTIONS preflight against a route
// registered as e.g. "POST /v1/locations" since OPTIONS doesn't match.
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

// correlationMiddleware reuses a client-supplied X-Correlation-Id (mirrors
// core-api's AssignCorrelationId middleware — see apps/core-api) or
// generates one, so a single GPS update can be traced through this
// service's logs and the Kafka events it produces.
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

// deviceAuthMiddleware authenticates the bearer token against driver device
// credentials — a credential distinct from any core-api user session (see
// AGENTS.md). Unknown/invalid/revoked tokens are a 401, not a validation
// rejection: the service doesn't know who's calling, so there is nothing
// yet to validate.
func deviceAuthMiddleware(authenticator DeviceAuthenticator, m *metrics.Metrics, logger *slog.Logger) func(http.Handler) http.Handler {
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
			logger.Info("authenticating device token", "token_hash", tokenHash, "correlation_id", correlationIDFromContext(r.Context()))

			device, err := authenticator.LookupByTokenHash(r.Context(), tokenHash)
			if errors.Is(err, devicestore.ErrNotFound) {
				m.AuthFailures.Inc()
				writeError(w, http.StatusUnauthorized, "unknown_device", "device token not recognized")
				return
			}
			if err != nil {
				logger.Error("device lookup failed", "error", err, "correlation_id", correlationIDFromContext(r.Context()))
				writeError(w, http.StatusServiceUnavailable, "device_lookup_unavailable", "could not verify device credentials")
				return
			}

			ctx := withDevice(r.Context(), device)
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

// loggingMiddleware emits one structured log line per request — the
// brief's "Request duration" observability requirement.
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

// chain applies middleware in the given order (first argument runs
// outermost) — a small local helper rather than a router dependency.
func chain(h http.Handler, mw ...func(http.Handler) http.Handler) http.Handler {
	for i := len(mw) - 1; i >= 0; i-- {
		h = mw[i](h)
	}
	return h
}
