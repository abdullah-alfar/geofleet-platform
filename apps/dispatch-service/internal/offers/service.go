// Package offers implements the driver-facing accept/reject actions on top
// of internal/offerstore's atomic transactions, publishing the resulting
// ride.offer.accepted.v1 / ride.assigned.v1 / ride.offer.rejected.v1
// events and (for rejections) re-triggering matching for the next
// candidate via internal/matching.
package offers

import (
	"context"
	"errors"
	"log/slog"

	"dispatch-service/internal/driverindex"
	"dispatch-service/internal/kafka"
	"dispatch-service/internal/matching"
	"dispatch-service/internal/metrics"
	"dispatch-service/internal/offerstore"
)

var ErrOfferNotAvailable = offerstore.ErrAlreadyClosed

type Service struct {
	store     *offerstore.Store
	index     *driverindex.Store
	matcher   *matching.Matcher
	publisher kafka.Publisher
	metrics   *metrics.Metrics
	logger    *slog.Logger
}

func New(store *offerstore.Store, index *driverindex.Store, matcher *matching.Matcher, publisher kafka.Publisher, m *metrics.Metrics, logger *slog.Logger) *Service {
	return &Service{store: store, index: index, matcher: matcher, publisher: publisher, metrics: m, logger: logger}
}

// Accept claims the offer and the ride atomically (see
// offerstore.Store.AcceptOffer for the concurrency guarantee), then
// publishes both the offer-level and ride-level result events.
// ErrOfferNotAvailable means someone/something else resolved it first
// (accepted, expired, or the ride was cancelled) — not a server error.
func (s *Service) Accept(ctx context.Context, offerUUID, driverUUID string, driverID int64, correlationID string) (*offerstore.AcceptedRide, error) {
	result, err := s.store.AcceptOffer(ctx, offerUUID, driverID)
	if errors.Is(err, offerstore.ErrAlreadyClosed) {
		return nil, ErrOfferNotAvailable
	}
	if err != nil {
		return nil, err
	}

	s.metrics.OffersAccepted.Inc()
	s.logger.Info("offers: accepted", "offer_id", offerUUID, "ride_request_id", result.RideRequestUUID, "driver_id", driverUUID)

	// A driver who just accepted a ride must stop being a dispatch
	// candidate for anything else — otherwise they could be offered (and
	// accept) a second, unrelated ride while already committed to this
	// one. This is dispatch-service's own "currently assigned" notion in
	// the geo-index, independent of drivers.is_available in Postgres
	// (core-api's own shift on/off toggle). There's no trip-completion
	// flow yet (Phase 6) to automatically bring them back — for now a
	// driver re-enters candidacy the next time they call PATCH
	// /api/v1/driver/availability.
	if err := s.index.SetAvailability(ctx, driverUUID, false); err != nil {
		s.logger.Error("offers: failed to remove driver from geo-index after acceptance", "driver_id", driverUUID, "error", err)
	}

	s.publish(ctx, "ride.offer.accepted.v1", "ride.offer.accepted", result.RideRequestUUID, result.RegionID, correlationID,
		map[string]string{"ride_request_id": result.RideRequestUUID, "offer_id": offerUUID, "driver_id": driverUUID})

	s.publish(ctx, "ride.assigned.v1", "ride.assigned", result.RideRequestUUID, result.RegionID, correlationID,
		map[string]string{
			"ride_request_id": result.RideRequestUUID,
			"driver_id":       driverUUID,
			"customer_id":     result.CustomerUUID,
		})

	return result, nil
}

// Reject records the decline, publishes ride.offer.rejected.v1, then
// synchronously re-runs the matching cycle so the next-best candidate gets
// an offer before this call returns — the driver's own request already
// paid the latency of one Kafka round trip's worth of thinking time, no
// reason to make the *next* candidate wait for an async retrigger too.
func (s *Service) Reject(ctx context.Context, offerUUID, driverUUID string, driverID int64, correlationID string) error {
	rejected, err := s.store.RejectOffer(ctx, offerUUID, driverID)
	if errors.Is(err, offerstore.ErrAlreadyClosed) {
		return ErrOfferNotAvailable
	}
	if err != nil {
		return err
	}

	s.metrics.OffersRejected.Inc()
	s.logger.Info("offers: rejected", "offer_id", offerUUID, "ride_request_id", rejected.RideRequestUUID, "driver_id", driverUUID)

	s.publish(ctx, "ride.offer.rejected.v1", "ride.offer.rejected", rejected.RideRequestUUID, rejected.RegionID, correlationID,
		map[string]string{"ride_request_id": rejected.RideRequestUUID, "offer_id": offerUUID, "driver_id": driverUUID})

	if err := s.matcher.RunCycle(ctx, rejected.RideRequestUUID, correlationID, nil); err != nil {
		s.logger.Error("offers: re-trigger after rejection failed", "ride_request_id", rejected.RideRequestUUID, "error", err)
	}

	return nil
}

func (s *Service) publish(ctx context.Context, topic, eventType, rideRequestUUID, regionID, correlationID string, data any) {
	if err := s.publisher.Publish(ctx, topic, rideRequestUUID, eventType, "ride_request", rideRequestUUID, regionID, correlationID, nil, data); err != nil {
		s.metrics.KafkaPublishErrors.Inc()
		s.logger.Error("offers: failed to publish event", "topic", topic, "ride_request_id", rideRequestUUID, "error", err)
	}
}
