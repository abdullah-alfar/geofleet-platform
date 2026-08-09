package kafka

import (
	"encoding/json"
	"time"
)

// Envelope mirrors the event envelope shape from
// docs/events/event-envelope.md exactly — see apps/location-service's
// identical copy. Data is left as raw JSON so callers can decode it into
// whichever concrete type matches this message's event_type.
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

// OutEnvelope is the publishing counterpart — Data is `any` here (not yet
// serialized) since producers build these fresh rather than decoding them.
type OutEnvelope struct {
	EventID       string    `json:"event_id"`
	EventType     string    `json:"event_type"`
	EventVersion  int       `json:"event_version"`
	OccurredAt    time.Time `json:"occurred_at"`
	Producer      string    `json:"producer"`
	CorrelationID string    `json:"correlation_id"`
	CausationID   *string   `json:"causation_id"`
	AggregateType string    `json:"aggregate_type"`
	AggregateID   string    `json:"aggregate_id"`
	RegionID      string    `json:"region_id"`
	Data          any       `json:"data"`
}
