package httpapi

import (
	"log/slog"
	"net/http"
	"time"
)

type ServerConfig struct {
	Port         string
	ReadTimeout  time.Duration
	WriteTimeout time.Duration
	IdleTimeout  time.Duration
}

func NewServer(
	cfg ServerConfig,
	wsHandler *WSHandler,
	healthHandler *HealthHandler,
	metricsHandler http.Handler,
	logger *slog.Logger,
) *http.Server {
	mux := http.NewServeMux()

	mux.HandleFunc("GET /healthz", healthHandler.Live)
	mux.HandleFunc("GET /readyz", healthHandler.Ready)
	mux.Handle("GET /metrics", metricsHandler)

	// WS routes are mounted directly, not through loggingMiddleware: that
	// middleware wraps http.ResponseWriter to capture a status code, and
	// websocket.Accept needs the *original* ResponseWriter to hijack the
	// connection. Connect/disconnect and duration are logged explicitly in
	// WSHandler.serveConn instead.
	mux.HandleFunc("GET /v1/ws/driver", wsHandler.ServeDriver)
	mux.HandleFunc("GET /v1/ws/customer", wsHandler.ServeCustomer)

	handler := chain(mux, corsMiddleware, correlationMiddleware, loggingMiddlewareExcept(logger, "/v1/ws/"))

	return &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      handler,
		ReadTimeout:  cfg.ReadTimeout,
		WriteTimeout: cfg.WriteTimeout,
		// WebSocket connections are long-lived — IdleTimeout would kill
		// them. net/http only applies IdleTimeout between requests on a
		// keep-alive connection, not to an already-hijacked one, so this
		// is safe for the WS routes and still bounds idle plain HTTP
		// connections (health checks, metrics scrapes).
		IdleTimeout: cfg.IdleTimeout,
	}
}
