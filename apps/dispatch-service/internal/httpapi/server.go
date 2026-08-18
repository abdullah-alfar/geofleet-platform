package httpapi

import (
	"log/slog"
	"net/http"
	"time"

	"dispatch-service/internal/metrics"
)

type ServerConfig struct {
	Port         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
}

func NewServer(
	cfg ServerConfig,
	offerHandler *OfferHandler,
	healthHandler *HealthHandler,
	metricsHandler http.Handler,
	authenticator DriverAuthenticator,
	m *metrics.Metrics,
	logger *slog.Logger,
) *http.Server {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", healthHandler.Live)
	mux.HandleFunc("GET /readyz", healthHandler.Ready)
	mux.Handle("GET /metrics", metricsHandler)

	auth := driverAuthMiddleware(authenticator, m, logger)
	mux.Handle("POST /v1/ride-offers/{id}/accept", chain(http.HandlerFunc(offerHandler.Accept), auth))
	mux.Handle("POST /v1/ride-offers/{id}/reject", chain(http.HandlerFunc(offerHandler.Reject), auth))
	mux.Handle("GET /v1/ride-offers/pending", chain(http.HandlerFunc(offerHandler.ListPending), auth))

	// correlationMiddleware must be outermost: loggingMiddleware reads the
	// correlation id after next.ServeHTTP returns, so it must already be
	// set on the request by the time logging runs (see
	// apps/location-service's identical fix from Phase 3).
	handler := chain(mux, corsMiddleware, correlationMiddleware, loggingMiddleware(logger))

	return &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      handler,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		IdleTimeout:  cfg.IdleTimeout,
	}
}
