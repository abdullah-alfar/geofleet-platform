package matching

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/twmb/franz-go/pkg/kgo"

	"dispatch-service/internal/kafka"
	"dispatch-service/internal/metrics"
	"dispatch-service/internal/types"
)

// NewRideRequestedHandler adapts ride.requested.v1 into a matching cycle.
// Unlike internal/indexconsumers' handlers, a failure here returns a real
// error (triggering the consumer's retry-then-skip-with-error-log
// behavior — see internal/kafka.Consumer.Run) since a failed matching
// attempt is worth retrying a couple of times before giving up, not a
// permanently-malformed message.
func NewRideRequestedHandler(matcher *Matcher, m *metrics.Metrics, logger *slog.Logger) kafka.HandlerFunc {
	return func(ctx context.Context, record *kgo.Record) error {
		var envelope kafka.Envelope
		if err := json.Unmarshal(record.Value, &envelope); err != nil {
			logger.Error("matching: malformed envelope", "error", err)
			return nil
		}

		var data types.RideRequested
		if err := json.Unmarshal(envelope.Data, &data); err != nil {
			logger.Error("matching: malformed ride.requested data", "error", err, "event_id", envelope.EventID)
			return nil
		}

		// Counts distinct ride.requested.v1 deliveries specifically —
		// RunCycle itself is also re-entered by offer expiry and driver
		// rejection (see matching.go's docblock), which aren't "received"
		// events in the sense this metric names.
		m.RideRequestsReceived.Inc()

		eventID := envelope.EventID
		return matcher.RunCycle(ctx, data.RideRequestID, envelope.CorrelationID, &eventID)
	}
}
