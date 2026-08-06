package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"location-service/internal/metrics"
)

type ServerConfig struct {
	Port         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
}

// NewServer wires the full route table with explicit timeouts at both the
// http.Server level (connection-wide) and, implicitly, via each handler's
// own context deadlines on outbound calls to Postgres/Redis/Kafka.
func NewServer(
	cfg ServerConfig,
	locationHandler *LocationHandler,
	healthHandler *HealthHandler,
	metricsHandler http.Handler,
	authenticator DeviceAuthenticator,
	m *metrics.Metrics,
	logger *slog.Logger,
) *http.Server {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", healthHandler.Live)
	mux.HandleFunc("GET /readyz", healthHandler.Ready)
	mux.Handle("GET /metrics", metricsHandler)

	locationRoute := chain(
		http.HandlerFunc(locationHandler.Handle),
		deviceAuthMiddleware(authenticator, m, logger),
	)
	mux.Handle("POST /v1/locations", locationRoute)

	// correlationMiddleware must be outermost: loggingMiddleware reads the
	// correlation id (via r.Context()) after next.ServeHTTP returns, so the
	// id has to already be set on the request by the time logging runs.
	handler := chain(mux, correlationMiddleware, loggingMiddleware(logger))

	return &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      handler,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}
}
