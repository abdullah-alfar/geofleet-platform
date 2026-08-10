// Package config loads realtime-gateway's configuration from environment
// variables into a plain value — no package-level mutable state.
package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

type Config struct {
	HTTPPort            string
	HTTPReadTimeout     time.Duration
	HTTPWriteTimeout    time.Duration
	HTTPIdleTimeout     time.Duration
	HTTPShutdownTimeout time.Duration

	PostgresDSN          string
	PostgresQueryTimeout time.Duration

	RedisAddr           string
	RedisPassword       string
	RedisCommandTimeout time.Duration

	KafkaBrokers  []string
	ConsumerGroup string

	// How long the ride_request_id -> customer_id correlation (built from
	// ride.requested.v1, since ride.unavailable.v1 doesn't carry
	// customer_id — see docs/decisions/0006) is kept in Redis. Bounded by
	// dispatch-service's own matching window (OfferTTL * MaxOfferAttempts,
	// a few minutes at defaults) plus margin.
	RideCorrelationTTL time.Duration

	// How long a driver_id -> (ride_request_id, customer_id) assignment
	// (built from ride.assigned.v1, used to relay driver.location.validated.v1
	// to the right customer) is kept. There's no trip-completion event yet
	// to clear it early, so this bounds staleness instead — see ADR 0006.
	DriverAssignmentTTL time.Duration

	// WebSocket keepalive: server-initiated pings and how long to wait for
	// a pong before treating the connection as dead.
	PingInterval time.Duration
	PongTimeout  time.Duration
}

func Load() (Config, error) {
	postgresDSN, err := requireEnv("REALTIME_GATEWAY_POSTGRES_DSN")
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		HTTPPort:            getEnv("HTTP_PORT", "8083"),
		HTTPReadTimeout:     getDuration("HTTP_READ_TIMEOUT", 5*time.Second),
		HTTPWriteTimeout:    getDuration("HTTP_WRITE_TIMEOUT", 5*time.Second),
		HTTPIdleTimeout:     getDuration("HTTP_IDLE_TIMEOUT", 60*time.Second),
		HTTPShutdownTimeout: getDuration("HTTP_SHUTDOWN_TIMEOUT", 10*time.Second),

		PostgresDSN:          postgresDSN,
		PostgresQueryTimeout: getDuration("POSTGRES_QUERY_TIMEOUT", 2*time.Second),

		RedisAddr:           getEnv("REDIS_ADDR", "127.0.0.1:63790"),
		RedisPassword:       getEnv("REDIS_PASSWORD", ""),
		RedisCommandTimeout: getDuration("REDIS_COMMAND_TIMEOUT", 1*time.Second),

		KafkaBrokers:  splitCSV(getEnv("KAFKA_BOOTSTRAP_SERVERS", "127.0.0.1:9094")),
		ConsumerGroup: getEnv("REALTIME_GATEWAY_CONSUMER_GROUP", "realtime-gateway"),

		RideCorrelationTTL:  getDuration("RIDE_CORRELATION_TTL", 30*time.Minute),
		DriverAssignmentTTL: getDuration("DRIVER_ASSIGNMENT_TTL", 4*time.Hour),

		PingInterval: getDuration("WS_PING_INTERVAL", 20*time.Second),
		PongTimeout:  getDuration("WS_PONG_TIMEOUT", 40*time.Second),
	}

	return cfg, nil
}

func requireEnv(key string) (string, error) {
	v := os.Getenv(key)
	if v == "" {
		return "", fmt.Errorf("required environment variable %s is not set", key)
	}
	return v, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}

func splitCSV(s string) []string {
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		if trimmed := strings.TrimSpace(p); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
