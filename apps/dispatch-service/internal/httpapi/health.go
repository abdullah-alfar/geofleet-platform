package httpapi

import (
	"context"
	"net/http"
	"time"
)

type Pinger interface {
	Ping(ctx context.Context) error
}

type PingerFunc func(ctx context.Context) error

func (f PingerFunc) Ping(ctx context.Context) error {
	return f(ctx)
}

type HealthHandler struct {
	deps             map[string]Pinger
	readinessTimeout time.Duration
}

func NewHealthHandler(deps map[string]Pinger, readinessTimeout time.Duration) *HealthHandler {
	return &HealthHandler{deps: deps, readinessTimeout: readinessTimeout}
}

func (h *HealthHandler) Live(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *HealthHandler) Ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), h.readinessTimeout)
	defer cancel()

	failures := map[string]string{}
	for name, dep := range h.deps {
		if err := dep.Ping(ctx); err != nil {
			failures[name] = err.Error()
		}
	}

	if len(failures) > 0 {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"status": "not_ready", "errors": failures})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}
