// Package kafka wraps franz-go for both producing (ride.* result events)
// and consuming (driver.location.validated.v1, driver.status.changed.v1,
// ride.requested.v1) — franz-go is the mature Kafka client mandated for Go
// services on this platform (docs/decisions/0001).
package kafka

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/twmb/franz-go/pkg/kgo"
)

const (
	eventVersion = 1
	producerName = "dispatch-service"
)

type Publisher interface {
	Publish(ctx context.Context, topic, key, eventType, aggregateType, aggregateID, regionID, correlationID string, causationID *string, data any) error
	// PublishRaw writes a pre-encoded payload with no envelope wrapping —
	// used only for internal/reliability's retry/DLQ envelopes, which are
	// deliberately NOT shaped like a domain event (see
	// docs/decisions/0007-retry-dlq-strategy.md): they're an ops artifact,
	// not something any other service should ever be a Kafka consumer of.
	PublishRaw(ctx context.Context, topic, key string, payload []byte) error
	Ping(ctx context.Context) error
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
		return nil, fmt.Errorf("kafka: new producer client: %w", err)
	}
	return &FranzPublisher{client: client, writeTimeout: writeTimeout}, nil
}

func (p *FranzPublisher) Publish(
	ctx context.Context,
	topic, key, eventType, aggregateType, aggregateID, regionID, correlationID string,
	causationID *string,
	data any,
) error {
	envelope := OutEnvelope{
		EventID:       uuid.NewString(),
		EventType:     eventType,
		EventVersion:  eventVersion,
		OccurredAt:    time.Now().UTC(),
		Producer:      producerName,
		CorrelationID: correlationID,
		CausationID:   causationID,
		AggregateType: aggregateType,
		AggregateID:   aggregateID,
		RegionID:      regionID,
		Data:          data,
	}

	payload, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("kafka: encode envelope: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, p.writeTimeout)
	defer cancel()

	record := &kgo.Record{Topic: topic, Key: []byte(key), Value: payload}

	result := p.client.ProduceSync(ctx, record)
	if err := result.FirstErr(); err != nil {
		return fmt.Errorf("kafka: publish to %s: %w", topic, err)
	}
	return nil
}

func (p *FranzPublisher) PublishRaw(ctx context.Context, topic, key string, payload []byte) error {
	ctx, cancel := context.WithTimeout(ctx, p.writeTimeout)
	defer cancel()

	record := &kgo.Record{Topic: topic, Key: []byte(key), Value: payload}

	result := p.client.ProduceSync(ctx, record)
	if err := result.FirstErr(); err != nil {
		return fmt.Errorf("kafka: publish raw to %s: %w", topic, err)
	}
	return nil
}

func (p *FranzPublisher) Ping(ctx context.Context) error {
	return p.client.Ping(ctx)
}

func (p *FranzPublisher) Close() {
	p.client.Close()
}
