// Package matching orchestrates one candidate-search-through-offer-or-
// unavailable cycle. RunCycle is intentionally the single entry point used
// by all three triggers this service has (a fresh ride.requested.v1, an
// expired offer, an explicit rejection) — see internal/offers and
// internal/expiry — so the search/rank/offer logic exists exactly once.
package matching

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"time"

	"dispatch-service/internal/driverindex"
	"dispatch-service/internal/driverprofile"
	"dispatch-service/internal/geohash"
	"dispatch-service/internal/kafka"
	"dispatch-service/internal/metrics"
	"dispatch-service/internal/offerstore"
	"dispatch-service/internal/ranking"
	"dispatch-service/internal/types"
)

type Config struct {
	GeohashPrecision uint
	StaleLocationAge time.Duration
	OfferTTL         time.Duration
	MaxOfferAttempts int
}

type Matcher struct {
	index     *driverindex.Store
	profiles  *driverprofile.CachedStore
	offers    *offerstore.Store
	publisher kafka.Publisher
	ranker    ranking.Ranker
	cfg       Config
	logger    *slog.Logger
	metrics   *metrics.Metrics
}

func New(
	index *driverindex.Store,
	profiles *driverprofile.CachedStore,
	offers *offerstore.Store,
	publisher kafka.Publisher,
	ranker ranking.Ranker,
	cfg Config,
	logger *slog.Logger,
	m *metrics.Metrics,
) *Matcher {
	return &Matcher{
		index: index, profiles: profiles, offers: offers,
		publisher: publisher, ranker: ranker, cfg: cfg, logger: logger, metrics: m,
	}
}

// RunCycle looks up the ride request fresh from Postgres every time it's
// called (rather than trusting data passed in from whatever triggered it),
// so it behaves identically regardless of trigger and never acts on stale
// information about a request that was cancelled or resolved moments ago.
func (m *Matcher) RunCycle(ctx context.Context, rideRequestUUID, correlationID string, causationEventID *string) error {
	start := time.Now()
	defer func() { m.metrics.MatchingDuration.Observe(time.Since(start).Seconds()) }()

	rideRequest, err := m.profiles.GetRideRequest(ctx, rideRequestUUID)
	if errors.Is(err, driverprofile.ErrNotFound) {
		m.logger.Warn("matching: ride request not found", "ride_request_id", rideRequestUUID)
		return nil
	}
	if err != nil {
		return fmt.Errorf("matching: load ride request: %w", err)
	}

	if rideRequest.Status != "searching" && rideRequest.Status != "offered" {
		// Already resolved (accepted/cancelled/unavailable/expired) by
		// something else — redelivery- and race-safe no-op. This single
		// guard is also how "customer cancellation during matching" and
		// Kafka redelivery of ride.requested.v1 are both handled: there is
		// nothing special-cased for either, they just fall into this check.
		return nil
	}

	isFirstCycle := rideRequest.Status == "searching"
	if isFirstCycle {
		m.publish(ctx, "ride.search.started.v1", "ride.search.started", "ride_request", rideRequest.UUID,
			rideRequest.RegionID, correlationID, causationEventID, map[string]string{"ride_request_id": rideRequest.UUID})
	}

	attempted, err := m.offers.CountOffers(ctx, rideRequest.ID)
	if err != nil {
		return fmt.Errorf("matching: count offers: %w", err)
	}
	if attempted >= m.cfg.MaxOfferAttempts {
		return m.markUnavailable(ctx, rideRequest, correlationID, causationEventID)
	}

	excluded, err := m.offers.ExistingOfferDriverUUIDs(ctx, rideRequest.ID)
	if err != nil {
		return fmt.Errorf("matching: existing offers: %w", err)
	}
	excludedSet := make(map[string]bool, len(excluded))
	for _, id := range excluded {
		excludedSet[id] = true
	}

	candidates, err := m.findCandidates(ctx, rideRequest, excludedSet)
	if err != nil {
		return fmt.Errorf("matching: find candidates: %w", err)
	}
	m.metrics.CandidatesFound.Observe(float64(len(candidates)))

	if len(candidates) == 0 {
		return m.markUnavailable(ctx, rideRequest, correlationID, causationEventID)
	}

	ranked := m.ranker.Rank(candidates)
	top := ranked[0]

	driverProfile, err := m.profiles.GetDriverProfile(ctx, top.DriverID)
	if err != nil {
		return fmt.Errorf("matching: reload top candidate profile: %w", err)
	}

	offer, err := m.offers.CreateOfferAndMarkOffered(ctx, rideRequest.ID, driverProfile.ID, m.cfg.OfferTTL)
	if err != nil {
		return fmt.Errorf("matching: create offer: %w", err)
	}

	m.metrics.OffersCreated.Inc()
	m.logger.Info("matching: offer created",
		"ride_request_id", rideRequest.UUID, "driver_id", top.DriverID, "offer_id", offer.UUID,
		"distance_meters", top.DistanceMeters, "candidates", len(candidates))

	m.publish(ctx, "ride.offer.created.v1", "ride.offer.created", "ride_request", rideRequest.UUID,
		rideRequest.RegionID, correlationID, causationEventID, map[string]any{
			"ride_request_id": rideRequest.UUID,
			"offer_id":        offer.UUID,
			"driver_id":       top.DriverID,
			"expires_at":      offer.ExpiresAt,
		})

	return nil
}

func (m *Matcher) markUnavailable(ctx context.Context, rideRequest *driverprofile.RideRequestRef, correlationID string, causationEventID *string) error {
	changed, err := m.offers.MarkUnavailable(ctx, rideRequest.ID)
	if err != nil {
		return fmt.Errorf("matching: mark unavailable: %w", err)
	}
	if !changed {
		return nil // resolved by something else concurrently — not our event to publish
	}

	m.metrics.RidesUnavailable.Inc()
	m.logger.Info("matching: no eligible candidates, ride marked unavailable", "ride_request_id", rideRequest.UUID)

	m.publish(ctx, "ride.unavailable.v1", "ride.unavailable", "ride_request", rideRequest.UUID,
		rideRequest.RegionID, correlationID, causationEventID, map[string]string{"ride_request_id": rideRequest.UUID})
	return nil
}

func (m *Matcher) findCandidates(ctx context.Context, rideRequest *driverprofile.RideRequestRef, excluded map[string]bool) ([]types.Candidate, error) {
	cells := geohash.CellsToSearch(rideRequest.PickupLat, rideRequest.PickupLng, m.cfg.GeohashPrecision)

	driverIDs, err := m.index.CandidateDriverIDs(ctx, cells)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	candidates := make([]types.Candidate, 0, len(driverIDs))

	for _, driverID := range driverIDs {
		if excluded[driverID] {
			continue
		}

		state, err := m.index.GetDriverState(ctx, driverID)
		if err != nil {
			m.logger.Warn("matching: failed to load driver state, skipping candidate", "driver_id", driverID, "error", err)
			continue
		}
		// Ignore drivers with stale GPS locations (brief's explicit
		// requirement) — a geocell SET entry alone is never trusted; the
		// actual last-updated timestamp is always re-checked here.
		if state == nil || !state.IsAvailable || now.Sub(state.UpdatedAt) > m.cfg.StaleLocationAge {
			continue
		}

		profile, err := m.profiles.GetDriverProfile(ctx, driverID)
		if errors.Is(err, driverprofile.ErrNotFound) {
			continue
		}
		if err != nil {
			m.logger.Warn("matching: failed to load driver profile, skipping candidate", "driver_id", driverID, "error", err)
			continue
		}
		if profile.Status != "active" {
			continue
		}
		if profile.VehicleType == nil || *profile.VehicleType != rideRequest.RequestedVehicleType {
			continue
		}

		idleSeconds := 0.0
		if profile.LastAvailableAt != nil {
			idleSeconds = now.Sub(*profile.LastAvailableAt).Seconds()
		}

		candidates = append(candidates, types.Candidate{
			DriverID:        driverID,
			DistanceMeters:  haversineMeters(state.Latitude, state.Longitude, rideRequest.PickupLat, rideRequest.PickupLng),
			RatingOrDefault: profile.Rating,
			AcceptanceRate:  profile.AcceptanceRate,
			IdleSeconds:     idleSeconds,
		})
	}

	return candidates, nil
}

func (m *Matcher) publish(ctx context.Context, topic, eventType, aggregateType, aggregateID, regionID, correlationID string, causationID *string, data any) {
	if err := m.publisher.Publish(ctx, topic, aggregateID, eventType, aggregateType, aggregateID, regionID, correlationID, causationID, data); err != nil {
		m.metrics.KafkaPublishErrors.Inc()
		m.logger.Error("matching: failed to publish event", "topic", topic, "aggregate_id", aggregateID, "error", err)
	}
}

const earthRadiusMeters = 6371000.0

func haversineMeters(lat1, lng1, lat2, lng2 float64) float64 {
	toRad := func(deg float64) float64 { return deg * math.Pi / 180 }

	dLat := toRad(lat2 - lat1)
	dLng := toRad(lng2 - lng1)

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(toRad(lat1))*math.Cos(toRad(lat2))*
			math.Sin(dLng/2)*math.Sin(dLng/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return earthRadiusMeters * c
}
