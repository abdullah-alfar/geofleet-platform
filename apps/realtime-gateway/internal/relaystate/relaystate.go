// Package relaystate holds the two small, TTL-bounded Redis-backed
// mappings realtime-gateway needs to route Kafka events it consumes to the
// right customer/driver channel, when the event payload itself doesn't
// carry that information. See docs/decisions/0006-realtime-gateway-fanout.md
// for why these live here instead of a new Postgres grant.
package relaystate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

var ErrNotFound = errors.New("relaystate: not found")

type Assignment struct {
	RideRequestUUID string `json:"ride_request_id"`
	CustomerUUID    string `json:"customer_id"`
}

type Store struct {
	redis               *redis.Client
	rideCorrelationTTL  time.Duration
	driverAssignmentTTL time.Duration
}

func New(redisClient *redis.Client, rideCorrelationTTL, driverAssignmentTTL time.Duration) *Store {
	return &Store{
		redis:               redisClient,
		rideCorrelationTTL:  rideCorrelationTTL,
		driverAssignmentTTL: driverAssignmentTTL,
	}
}

func rideCustomerKey(rideRequestUUID string) string {
	return "rt:ride:" + rideRequestUUID + ":customer"
}
func driverAssignmentKey(driverUUID string) string { return "rt:assignment:" + driverUUID }

// SetRideCustomer records which customer a ride request belongs to, from
// ride.requested.v1 (the only event in this flow that actually carries
// customer_id alongside ride_request_id). Read back later when relaying
// ride.unavailable.v1, which — by design, see the topic-catalog note on
// dispatch-service's customer-PII scope — doesn't carry customer_id
// itself.
func (s *Store) SetRideCustomer(ctx context.Context, rideRequestUUID, customerUUID string) error {
	if err := s.redis.Set(ctx, rideCustomerKey(rideRequestUUID), customerUUID, s.rideCorrelationTTL).Err(); err != nil {
		return fmt.Errorf("relaystate: set ride customer: %w", err)
	}
	return nil
}

func (s *Store) GetRideCustomer(ctx context.Context, rideRequestUUID string) (string, error) {
	customerUUID, err := s.redis.Get(ctx, rideCustomerKey(rideRequestUUID)).Result()
	if errors.Is(err, redis.Nil) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("relaystate: get ride customer: %w", err)
	}
	return customerUUID, nil
}

// SetDriverAssignment records that a driver is currently working a ride,
// from ride.assigned.v1, so driver.location.validated.v1 updates for that
// driver can be relayed to the right customer. TTL-bounded rather than
// cleared on trip completion, because no trip-completion event exists yet
// (trips aren't created by anything in core-api today — see ADR 0006);
// worst case a customer keeps receiving their former driver's location for
// up to the TTL after a trip actually ends.
func (s *Store) SetDriverAssignment(ctx context.Context, driverUUID string, a Assignment) error {
	payload, err := json.Marshal(a)
	if err != nil {
		return fmt.Errorf("relaystate: marshal assignment: %w", err)
	}
	if err := s.redis.Set(ctx, driverAssignmentKey(driverUUID), payload, s.driverAssignmentTTL).Err(); err != nil {
		return fmt.Errorf("relaystate: set driver assignment: %w", err)
	}
	return nil
}

func (s *Store) GetDriverAssignment(ctx context.Context, driverUUID string) (*Assignment, error) {
	payload, err := s.redis.Get(ctx, driverAssignmentKey(driverUUID)).Result()
	if errors.Is(err, redis.Nil) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("relaystate: get driver assignment: %w", err)
	}

	var a Assignment
	if err := json.Unmarshal([]byte(payload), &a); err != nil {
		return nil, fmt.Errorf("relaystate: unmarshal assignment: %w", err)
	}
	return &a, nil
}
