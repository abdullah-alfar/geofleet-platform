// Package expiry runs a periodic sweep that expires pending offers past
// their expires_at and re-triggers matching for the next candidate.
//
// There is deliberately no ride.offer.expired.v1 event — it's not in the
// Phase 1 topic catalog (auto-topic-creation is disabled, so publishing to
// it would fail), and it isn't needed: the sweep's downstream effect (a new
// offer, or the ride going unavailable) is what other services actually
// need to react to, and that's published by internal/matching regardless
// of what triggered the cycle. See docs/events/topic-catalog.md.
package expiry

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"dispatch-service/internal/matching"
	"dispatch-service/internal/metrics"
	"dispatch-service/internal/offerstore"
)

type Sweeper struct {
	store    *offerstore.Store
	matcher  *matching.Matcher
	interval time.Duration
	logger   *slog.Logger
	metrics  *metrics.Metrics
}

func New(store *offerstore.Store, matcher *matching.Matcher, interval time.Duration, m *metrics.Metrics, logger *slog.Logger) *Sweeper {
	return &Sweeper{store: store, matcher: matcher, interval: interval, metrics: m, logger: logger}
}

func (s *Sweeper) Run(ctx context.Context) {
	ticker := time.NewTicker(s.interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.sweep(ctx)
		}
	}
}

func (s *Sweeper) sweep(ctx context.Context) {
	expired, err := s.store.ExpireStaleOffers(ctx)
	if err != nil {
		s.logger.Error("expiry: sweep failed", "error", err)
		return
	}

	for _, e := range expired {
		s.metrics.OffersExpired.Inc()
		s.logger.Info("expiry: offer expired, re-triggering matching", "ride_request_id", e.RideRequestUUID)

		// A fresh correlation id: this cycle wasn't caused by any single
		// upstream event, it's the sweep's own initiative.
		if err := s.matcher.RunCycle(ctx, e.RideRequestUUID, uuid.NewString(), nil); err != nil {
			s.logger.Error("expiry: re-trigger matching failed", "ride_request_id", e.RideRequestUUID, "error", err)
		}
	}
}
