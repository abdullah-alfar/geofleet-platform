// Package kafka publishes GPS events using franz-go — the mature Kafka
// client mandated for Go services in this platform (see
// docs/decisions/0001-kafka-over-alternative-queues.md). Auto-topic-creation
// is disabled cluster-wide (infrastructure/kafka/init-topics.sh), so both
// topics this package writes to must already exist in the topic catalog.
package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"

	"location-service/internal/gps"
)

const (
	TopicLocationReceived  = "driver.location.received.v1"
	TopicLocationValidated = "driver.location.validated.v1"

	eventVersion = 1
	producerName = "location-service"
)

// Publisher is the interface httpapi depends on — lets tests substitute a
// fake without pulling in a real Kafka client.
type Publisher interface {
	PublishReceived(ctx context.Context, update gps.Update, correlationID string) error
	PublishValidated(ctx context.Context, update gps.Update, regionID string, correlationID string) error
	Close()
}

type FranzPublisher struct {
	client       *kgo.Client
	writeTimeout time.Duration
}

func NewFranzPublisher(brokers []string, writeTimeout time.Duration) (*FranzPublisher, error) {
	client, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.RequiredAcks(kgo.AllISRAcks()),
		kgo.ProducerBatchCompression(kgo.SnappyCompression()),
	)
	if err != nil {
		return nil, fmt.Errorf("kafka: new client: %w", err)
	}

	return &FranzPublisher{client: client, writeTimeout: writeTimeout}, nil
}

func (p *FranzPublisher) PublishReceived(ctx context.Context, update gps.Update, correlationID string) error {
	envelope := Envelope{
		EventID:       uuid.NewString(),
		EventType:     "driver.location.received",
		EventVersion:  eventVersion,
		OccurredAt:    time.Now().UTC(),
		Producer:      producerName,
		CorrelationID: correlationID,
		AggregateType: "driver",
		AggregateID:   update.DriverID,
		// region_id isn't known yet at "received" time (auth/lookup hasn't
		// necessarily completed) — downstream consumers of this raw stream
		// should treat it as informational/audit only, not routing input.
		RegionID: "",
		Data:     update,
	}

	return p.publish(ctx, TopicLocationReceived, update.DriverID, envelope)
}

func (p *FranzPublisher) PublishValidated(ctx context.Context, update gps.Update, regionID string, correlationID string) error {
	envelope := Envelope{
		EventID:       uuid.NewString(),
		EventType:     "driver.location.validated",
		EventVersion:  eventVersion,
		OccurredAt:    time.Now().UTC(),
		Producer:      producerName,
		CorrelationID: correlationID,
		AggregateType: "driver",
		AggregateID:   update.DriverID,
		RegionID:      regionID,
		Data:          update,
	}

	return p.publish(ctx, TopicLocationValidated, update.DriverID, envelope)
}

func (p *FranzPublisher) publish(ctx context.Context, topic, key string, envelope Envelope) error {
	payload, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("kafka: encode envelope: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, p.writeTimeout)
	defer cancel()

	record := &kgo.Record{
		Topic: topic,
		Key:   []byte(key),
		Value: payload,
	}

	// Synchronous, per-message produce: simplest correct approach at this
	// service's expected local-dev/MVP volume. Async batched production
	// (franz-go supports it natively) is the throughput optimization for
	// the Phase 8 scalability pass, not needed to prove correctness now.
	result := p.client.ProduceSync(ctx, record)
	if err := result.FirstErr(); err != nil {
		return fmt.Errorf("kafka: publish to %s: %w", topic, err)
	}
	return nil
}

// Ping satisfies httpapi.Pinger for the /readyz endpoint.
func (p *FranzPublisher) Ping(ctx context.Context) error {
	return p.client.Ping(ctx)
}

func (p *FranzPublisher) Close() {
	p.client.Close()
}
