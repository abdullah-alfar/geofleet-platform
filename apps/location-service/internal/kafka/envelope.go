package kafka

import "time"

// Envelope mirrors the event envelope shape from docs/events/event-envelope.md
// / AGENTS.md exactly, so every Kafka message on this platform — Laravel or
// Go, GPS or ride lifecycle — is structurally identical.
type Envelope struct {
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
