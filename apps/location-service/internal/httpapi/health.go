package httpapi

import (
	"context"
	"net/http"
	"time"
)

// Pinger is implemented by each external dependency's client. *pgxpool.Pool
// and *kgo.Client already satisfy this shape natively; go-redis's
// Ping returns a *redis.StatusCmd, so it's wrapped with PingerFunc below.
type Pinger interface {
	Ping(ctx context.Context) error
}

// PingerFunc adapts a plain func to Pinger — used for dependencies whose
// native Ping signature doesn't already match (e.g. go-redis).
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

// Live is a pure liveness check — if the process can answer HTTP at all, it
// is live. Never depends on external systems (a Postgres/Redis/Kafka outage
// must not make an orchestrator kill and restart an otherwise-healthy
// process).
func (h *HealthHandler) Live(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// Ready checks every dependency this service actually needs to function.
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
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"status": "not_ready",
			"errors": failures,
		})
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "ready"})
}
