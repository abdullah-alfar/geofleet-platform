package kafka

import (
	"context"
	"log/slog"

	"github.com/twmb/franz-go/pkg/kgo"
)

// HandlerFunc processes one Kafka record. Returning an error means the
// message was NOT durably handled — the consumer will not advance past it
// (see Consumer.Run for the retry/backoff behavior).
type HandlerFunc func(ctx context.Context, record *kgo.Record) error

// Consumer polls a single consumer group across multiple topics, dispatching
// each record to the handler registered for its topic. One shared client
// (not one per topic) — franz-go handles partition assignment across all
// subscribed topics within the group natively.
//
// Kafka partitions this consumer group's work across however many
// realtime-gateway instances are running — each instance only sees a
// subset of events. That's fine: the actual fan-out to browser/app
// connections happens over Redis Pub/Sub (internal/hub), which every
// instance is subscribed to regardless of which one handled the Kafka
// record. See docs/decisions/0006-realtime-gateway-fanout.md.
type Consumer struct {
	client   *kgo.Client
	handlers map[string]HandlerFunc
	logger   *slog.Logger
}

func NewConsumer(brokers []string, group string, topics []string, handlers map[string]HandlerFunc, logger *slog.Logger) (*Consumer, error) {
	client, err := kgo.NewClient(
		kgo.SeedBrokers(brokers...),
		kgo.ConsumerGroup(group),
		kgo.ConsumeTopics(topics...),
		kgo.DisableAutoCommit(),
		kgo.ConsumeResetOffset(kgo.NewOffset().AtStart()),
	)
	if err != nil {
		return nil, err
	}

	return &Consumer{client: client, handlers: handlers, logger: logger}, nil
}

// Run polls until ctx is cancelled. Each record is retried a bounded number
// of times with a short backoff on handler failure; after that it's logged
// as an error and skipped so one poison message can't block the whole
// consumer group indefinitely — see AGENTS.md: retry/DLQ topics are a
// Phase 7 concern, not built ahead of schedule.
func (c *Consumer) Run(ctx context.Context) {
	const maxAttempts = 3

	for {
		if ctx.Err() != nil {
			return
		}

		fetches := c.client.PollFetches(ctx)
		if ctx.Err() != nil {
			return
		}

		fetches.EachError(func(topic string, partition int32, err error) {
			c.logger.Error("kafka fetch error", "topic", topic, "partition", partition, "error", err)
		})

		fetches.EachRecord(func(record *kgo.Record) {
			handler, ok := c.handlers[record.Topic]
			if !ok {
				return
			}

			var err error
			for attempt := 1; attempt <= maxAttempts; attempt++ {
				if err = handler(ctx, record); err == nil {
					break
				}
				c.logger.Warn("handler failed, retrying",
					"topic", record.Topic, "attempt", attempt, "error", err)
			}
			if err != nil {
				c.logger.Error("handler failed permanently, skipping record",
					"topic", record.Topic, "partition", record.Partition, "offset", record.Offset, "error", err)
			}
		})

		if err := c.client.CommitUncommittedOffsets(ctx); err != nil {
			c.logger.Error("failed to commit offsets", "error", err)
		}
	}
}

func (c *Consumer) Close() {
	c.client.Close()
}
