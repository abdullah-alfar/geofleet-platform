// Package indexconsumers wires driver.location.validated.v1 and
// driver.status.changed.v1 into internal/driverindex. Redis SADD/SREM/HSET
// are idempotent by construction, so — unlike core-api's location consumer,
// which does non-idempotent Postgres INSERTs and therefore needs the inbox
// pattern — these handlers need no separate idempotency ledger. Redelivery
// just reapplies the same state, which is a no-op. See
// docs/decisions/0005-geohash-and-dispatch-db-access.md.
package indexconsumers

import (
	"context"
	"encoding/json"
	"log/slog"

	"github.com/twmb/franz-go/pkg/kgo"

	"dispatch-service/internal/driverindex"
	"dispatch-service/internal/kafka"
	"dispatch-service/internal/types"
)

// NewLocationHandler updates a driver's position (and, if they're
// currently available, their geocell membership) on every
// driver.location.validated.v1 event.
func NewLocationHandler(store *driverindex.Store, logger *slog.Logger) kafka.HandlerFunc {
	return func(ctx context.Context, record *kgo.Record) error {
		var envelope kafka.Envelope
		if err := json.Unmarshal(record.Value, &envelope); err != nil {
			logger.Error("indexconsumers: malformed envelope", "error", err)
			return nil // not retryable — will never parse differently
		}

		var data types.DriverLocationValidated
		if err := json.Unmarshal(envelope.Data, &data); err != nil {
			logger.Error("indexconsumers: malformed location data", "error", err, "event_id", envelope.EventID)
			return nil
		}

		return store.UpdateLocation(ctx, data.DriverID, data.Latitude, data.Longitude, data.RecordedAt)
	}
}

// NewStatusHandler adds/removes a driver from their geocell's candidate SET
// as they go online/offline, on every driver.status.changed.v1 event.
func NewStatusHandler(store *driverindex.Store, logger *slog.Logger) kafka.HandlerFunc {
	return func(ctx context.Context, record *kgo.Record) error {
		var envelope kafka.Envelope
		if err := json.Unmarshal(record.Value, &envelope); err != nil {
			logger.Error("indexconsumers: malformed envelope", "error", err)
			return nil
		}

		var data types.DriverStatusChanged
		if err := json.Unmarshal(envelope.Data, &data); err != nil {
			logger.Error("indexconsumers: malformed status data", "error", err, "event_id", envelope.EventID)
			return nil
		}

		return store.SetAvailability(ctx, data.DriverID, data.IsAvailable)
	}
}
