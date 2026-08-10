package kafka

import (
	"encoding/json"
	"time"
)

// Envelope mirrors the event envelope shape from
// docs/events/event-envelope.md exactly — see apps/dispatch-service's
// identical copy. Data is left as raw JSON so callers can decode it into
// whichever concrete type matches this message's event_type.
//
// realtime-gateway only ever consumes events, never publishes any (see
// docs/decisions/0006-realtime-gateway-fanout.md) — so unlike the other Go
// services, there's no OutEnvelope here.
type Envelope struct {
	EventID       string          `json:"event_id"`
	EventType     string          `json:"event_type"`
	EventVersion  int             `json:"event_version"`
	OccurredAt    time.Time       `json:"occurred_at"`
	Producer      string          `json:"producer"`
	CorrelationID string          `json:"correlation_id"`
	CausationID   *string         `json:"causation_id"`
	AggregateType string          `json:"aggregate_type"`
	AggregateID   string          `json:"aggregate_id"`
	RegionID      string          `json:"region_id"`
	Data          json.RawMessage `json:"data"`
}
