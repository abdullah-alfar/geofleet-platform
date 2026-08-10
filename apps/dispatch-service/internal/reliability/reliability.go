// Package reliability implements the platform's retry-topic/DLQ policy
// (see docs/decisions/0007-retry-dlq-strategy.md and
// docs/events/retry-and-dlq.md) for the one consumer in this service where
// a permanently dropped message means real, unrecoverable data loss:
// ride.requested.v1's matching handler.
//
// Two pieces, meant to run on two SEPARATE consumers (see cmd/dispatch-service):
//
//   - WithRetryTopic wraps the main topic's handler. On failure it
//     publishes to "{topic}.retry" and returns nil — it does not sleep or
//     block the main topic's partition, which is why this can't just be
//     "one more handler on the existing consumer."
//   - NewRetryTopicHandler is the retry topic's own handler, run by an
//     isolated consumer (own consumer group, own goroutine). It sleeps a
//     backoff schedule before every reattempt — safe to block here
//     specifically because nothing else shares this consumer's partition.
package reliability

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/twmb/franz-go/pkg/kgo"

	"dispatch-service/internal/kafka"
)

// BackoffSchedule is how long the retry-topic consumer waits before each
// reattempt. Its length is also the max number of retry-topic attempts
// before a message is routed to the DLQ.
var BackoffSchedule = []time.Duration{30 * time.Second, 2 * time.Minute, 10 * time.Minute}

// RetryEnvelope wraps a message that failed processing. It is
// deliberately NOT the standard event envelope (docs/events/event-envelope.md)
// — Payload carries that envelope, unmodified, as opaque bytes, so
// whatever eventually reprocesses it (the retry handler, or a replayed
// message from the DLQ) sees exactly the original record value.
type RetryEnvelope struct {
	OriginalTopic string          `json:"original_topic"`
	Attempt       int             `json:"attempt"`
	FirstFailedAt time.Time       `json:"first_failed_at"`
	LastError     string          `json:"last_error"`
	Payload       json.RawMessage `json:"payload"`
}

// WithRetryTopic returns a HandlerFunc for the main topic: on success,
// unchanged behavior. On failure, instead of the generic
// kafka.Consumer.Run's own log-and-skip, it publishes a RetryEnvelope
// (attempt 1) to topic+".retry" and returns nil — the message is never
// silently dropped, and the main consumer is never blocked waiting on it.
// fastRetryAttempts and fastRetryBackoff are WithRetryTopic's own inline
// retry loop — deliberately self-contained rather than relying on
// kafka.Consumer.Run's generic retry-then-log-and-skip loop, since
// WithRetryTopic always returns nil once it has handed a failure off to
// the retry topic (see below), which would make the outer loop's own
// retries never actually run.
const (
	fastRetryAttempts = 3
	fastRetryBackoff  = 200 * time.Millisecond
)

func WithRetryTopic(topic string, handler kafka.HandlerFunc, publisher kafka.Publisher, logger *slog.Logger) kafka.HandlerFunc {
	return func(ctx context.Context, record *kgo.Record) error {
		var err error
		for attempt := 1; attempt <= fastRetryAttempts; attempt++ {
			if err = handler(ctx, record); err == nil {
				return nil
			}
			if attempt < fastRetryAttempts {
				logger.Warn("reliability: handler failed, retrying inline",
					"topic", topic, "attempt", attempt, "error", err)
				time.Sleep(fastRetryBackoff * time.Duration(attempt))
			}
		}

		logger.Warn("reliability: handler failed after inline retries, routing to retry topic",
			"topic", topic, "attempts", fastRetryAttempts, "error", err)

		envelope := RetryEnvelope{
			OriginalTopic: topic,
			Attempt:       1,
			FirstFailedAt: time.Now().UTC(),
			LastError:     err.Error(),
			Payload:       append(json.RawMessage(nil), record.Value...),
		}
		if pubErr := publishEnvelope(ctx, publisher, topic+".retry", record.Key, envelope); pubErr != nil {
			// Publishing the retry envelope itself failed — this is the
			// one case worth propagating to the outer consumer's own
			// retry loop, since there's genuinely nowhere else for the
			// message to go yet.
			return fmt.Errorf("reliability: publish to retry topic: %w", pubErr)
		}
		return nil
	}
}

// NewRetryTopicHandler returns the retry topic's own handler: decode the
// RetryEnvelope, sleep this attempt's backoff, and re-invoke the original
// handler against the unwrapped payload. Success ends it. Failure either
// re-enqueues with attempt+1, or — once BackoffSchedule is exhausted —
// routes to topic+".dlq".
func NewRetryTopicHandler(topic string, handler kafka.HandlerFunc, publisher kafka.Publisher, logger *slog.Logger) kafka.HandlerFunc {
	return func(ctx context.Context, record *kgo.Record) error {
		var envelope RetryEnvelope
		if err := json.Unmarshal(record.Value, &envelope); err != nil {
			logger.Error("reliability: malformed retry envelope, dropping", "topic", topic, "error", err)
			return nil
		}

		select {
		case <-time.After(backoffFor(envelope.Attempt)):
		case <-ctx.Done():
			return ctx.Err()
		}

		innerRecord := &kgo.Record{Topic: topic, Key: record.Key, Value: envelope.Payload}
		if err := handler(ctx, innerRecord); err == nil {
			logger.Info("reliability: retry succeeded", "topic", topic, "attempt", envelope.Attempt)
			return nil
		} else if envelope.Attempt >= len(BackoffSchedule) {
			logger.Error("reliability: retry attempts exhausted, routing to DLQ",
				"topic", topic, "attempts", envelope.Attempt, "error", err)
			envelope.LastError = err.Error()
			return publishEnvelope(ctx, publisher, topic+".dlq", record.Key, envelope)
		} else {
			logger.Warn("reliability: retry attempt failed, re-enqueueing",
				"topic", topic, "attempt", envelope.Attempt, "error", err)
			envelope.Attempt++
			envelope.LastError = err.Error()
			return publishEnvelope(ctx, publisher, topic+".retry", record.Key, envelope)
		}
	}
}

func backoffFor(attempt int) time.Duration {
	idx := attempt - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(BackoffSchedule) {
		idx = len(BackoffSchedule) - 1
	}
	return BackoffSchedule[idx]
}

func publishEnvelope(ctx context.Context, publisher kafka.Publisher, topic string, key []byte, envelope RetryEnvelope) error {
	payload, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("reliability: marshal retry envelope: %w", err)
	}
	if err := publisher.PublishRaw(ctx, topic, string(key), payload); err != nil {
		return fmt.Errorf("reliability: publish to %s: %w", topic, err)
	}
	return nil
}
