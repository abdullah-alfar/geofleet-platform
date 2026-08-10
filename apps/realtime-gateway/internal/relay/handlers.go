// Package relay adapts Kafka events into hub.Hub deliveries — one handler
// per topic this service consumes. Each handler decodes the envelope, does
// whatever small bit of correlation bookkeeping it owns (internal/relaystate),
// and publishes a hub.Message to the right driver or customer channel.
//
// A malformed envelope/payload is logged and dropped (return nil) rather
// than retried — same reasoning as apps/dispatch-service's
// internal/indexconsumers: it will never parse differently on retry. A
// Redis failure while relaying is returned as an error so the consumer
// retries it (see internal/kafka.Consumer.Run).
package relay

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"

	"github.com/twmb/franz-go/pkg/kgo"

	"realtime-gateway/internal/hub"
	rgkafka "realtime-gateway/internal/kafka"
	"realtime-gateway/internal/metrics"
	"realtime-gateway/internal/relaystate"
	"realtime-gateway/internal/types"
)

// NewRideRequestedHandler records the ride_request_id -> customer_id
// correlation (see internal/relaystate) — this event carries customer_id,
// which ride.unavailable.v1 later does not.
func NewRideRequestedHandler(state *relaystate.Store, logger *slog.Logger) rgkafka.HandlerFunc {
	return func(ctx context.Context, record *kgo.Record) error {
		var envelope rgkafka.Envelope
		if err := json.Unmarshal(record.Value, &envelope); err != nil {
			logger.Error("relay: malformed envelope", "topic", record.Topic, "error", err)
			return nil
		}

		var data types.RideRequested
		if err := json.Unmarshal(envelope.Data, &data); err != nil {
			logger.Error("relay: malformed ride.requested data", "error", err, "event_id", envelope.EventID)
			return nil
		}

		return state.SetRideCustomer(ctx, data.RideRequestID, data.CustomerID)
	}
}

// NewOfferCreatedHandler pushes a new ride offer straight to the driver it
// was created for, instead of leaving them to poll
// GET /v1/ride-offers/pending (apps/dispatch-service, Phase 5).
func NewOfferCreatedHandler(h *hub.Hub, m *metrics.Metrics, logger *slog.Logger) rgkafka.HandlerFunc {
	return func(ctx context.Context, record *kgo.Record) error {
		var envelope rgkafka.Envelope
		if err := json.Unmarshal(record.Value, &envelope); err != nil {
			logger.Error("relay: malformed envelope", "topic", record.Topic, "error", err)
			return nil
		}

		var data types.RideOfferCreated
		if err := json.Unmarshal(envelope.Data, &data); err != nil {
			logger.Error("relay: malformed ride.offer.created data", "error", err, "event_id", envelope.EventID)
			return nil
		}

		msg := hub.Message{Type: "ride.offer.created", Data: map[string]any{
			"ride_request_id": data.RideRequestID,
			"offer_id":        data.OfferID,
			"expires_at":      data.ExpiresAt,
		}}
		if err := h.Publish(ctx, hub.DriverChannel(data.DriverID), msg); err != nil {
			return err
		}
		m.KafkaEventsRelayed.WithLabelValues("ride.offer.created").Inc()
		return nil
	}
}

// NewRideAssignedHandler notifies the customer their ride was assigned,
// and records the driver_id -> (ride_request_id, customer_id) assignment
// (see internal/relaystate) that NewDriverLocationHandler uses to relay
// this driver's subsequent live location to this customer.
func NewRideAssignedHandler(state *relaystate.Store, h *hub.Hub, m *metrics.Metrics, logger *slog.Logger) rgkafka.HandlerFunc {
	return func(ctx context.Context, record *kgo.Record) error {
		var envelope rgkafka.Envelope
		if err := json.Unmarshal(record.Value, &envelope); err != nil {
			logger.Error("relay: malformed envelope", "topic", record.Topic, "error", err)
			return nil
		}

		var data types.RideAssigned
		if err := json.Unmarshal(envelope.Data, &data); err != nil {
			logger.Error("relay: malformed ride.assigned data", "error", err, "event_id", envelope.EventID)
			return nil
		}

		if err := state.SetDriverAssignment(ctx, data.DriverID, relaystate.Assignment{
			RideRequestUUID: data.RideRequestID,
			CustomerUUID:    data.CustomerID,
		}); err != nil {
			return err
		}

		msg := hub.Message{Type: "ride.assigned", Data: map[string]any{
			"ride_request_id": data.RideRequestID,
			"driver_id":       data.DriverID,
		}}
		if err := h.Publish(ctx, hub.CustomerChannel(data.CustomerID), msg); err != nil {
			return err
		}
		m.KafkaEventsRelayed.WithLabelValues("ride.assigned").Inc()
		return nil
	}
}

// NewRideUnavailableHandler notifies the customer no driver was found.
// This event doesn't carry customer_id (see docs/decisions/0006 — it's
// dispatch-service's own scope boundary), so the customer is resolved from
// the ride.requested.v1-derived correlation instead. If that's already
// expired (RideCorrelationTTL) or was never seen — e.g. this instance
// started after the ride was requested — there's nowhere to route the
// notification, so it's dropped; the customer's own
// GET /api/v1/ride-requests/{id} poll is the fallback of last resort.
func NewRideUnavailableHandler(state *relaystate.Store, h *hub.Hub, m *metrics.Metrics, logger *slog.Logger) rgkafka.HandlerFunc {
	return func(ctx context.Context, record *kgo.Record) error {
		var envelope rgkafka.Envelope
		if err := json.Unmarshal(record.Value, &envelope); err != nil {
			logger.Error("relay: malformed envelope", "topic", record.Topic, "error", err)
			return nil
		}

		var data types.RideUnavailable
		if err := json.Unmarshal(envelope.Data, &data); err != nil {
			logger.Error("relay: malformed ride.unavailable data", "error", err, "event_id", envelope.EventID)
			return nil
		}

		customerUUID, err := state.GetRideCustomer(ctx, data.RideRequestID)
		if errors.Is(err, relaystate.ErrNotFound) {
			logger.Warn("relay: no known customer for ride.unavailable.v1, dropping", "ride_request_id", data.RideRequestID)
			return nil
		}
		if err != nil {
			return err
		}

		msg := hub.Message{Type: "ride.unavailable", Data: map[string]any{"ride_request_id": data.RideRequestID}}
		if err := h.Publish(ctx, hub.CustomerChannel(customerUUID), msg); err != nil {
			return err
		}
		m.KafkaEventsRelayed.WithLabelValues("ride.unavailable").Inc()
		return nil
	}
}

// NewDriverLocationHandler relays a driver's live location to their
// currently assigned customer, if any. Most driver.location.validated.v1
// events are for drivers with no active assignment (idle/cruising) — that
// is the expected common case, not an error, so it's a silent no-op.
func NewDriverLocationHandler(state *relaystate.Store, h *hub.Hub, m *metrics.Metrics, logger *slog.Logger) rgkafka.HandlerFunc {
	return func(ctx context.Context, record *kgo.Record) error {
		var envelope rgkafka.Envelope
		if err := json.Unmarshal(record.Value, &envelope); err != nil {
			logger.Error("relay: malformed envelope", "topic", record.Topic, "error", err)
			return nil
		}

		var data types.DriverLocationValidated
		if err := json.Unmarshal(envelope.Data, &data); err != nil {
			logger.Error("relay: malformed driver.location.validated data", "error", err, "event_id", envelope.EventID)
			return nil
		}

		assignment, err := state.GetDriverAssignment(ctx, data.DriverID)
		if errors.Is(err, relaystate.ErrNotFound) {
			return nil
		}
		if err != nil {
			return err
		}

		msg := hub.Message{Type: "driver.location", Data: map[string]any{
			"ride_request_id": assignment.RideRequestUUID,
			"driver_id":       data.DriverID,
			"lat":             data.Latitude,
			"lng":             data.Longitude,
			"recorded_at":     data.RecordedAt,
		}}
		if err := h.Publish(ctx, hub.CustomerChannel(assignment.CustomerUUID), msg); err != nil {
			return err
		}
		m.KafkaEventsRelayed.WithLabelValues("driver.location").Inc()
		return nil
	}
}
