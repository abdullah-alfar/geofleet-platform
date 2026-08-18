package httpapi

import (
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

// corsMiddleware allows browser-based clients (apps/driver-web,
// apps/rider-web) to hit /healthz, /readyz, /metrics from a different
// origin/port — see apps/location-service's identical middleware for the
// full reasoning. The WS routes need their own fix (websocket.Accept's
// origin check, see ws.go) since a GET WS-upgrade request is never
// preflighted with OPTIONS the way this middleware handles.
func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
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
		next.ServeHTTP(w, r)
	})
}

// loggingMiddlewareExcept logs every request except those under
// skipPrefix (the WS upgrade routes — see server.go for why those can't
// be wrapped).
func loggingMiddlewareExcept(logger *slog.Logger, skipPrefix string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if strings.HasPrefix(r.URL.Path, skipPrefix) {
				next.ServeHTTP(w, r)
				return
			}

			start := time.Now()
			rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(rec, r)

			logger.Info("http_request",
				"method", r.Method,
				"path", r.URL.Path,
				"status", rec.status,
				"duration_ms", time.Since(start).Milliseconds(),
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
