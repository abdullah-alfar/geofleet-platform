// Package config loads dispatch-service's configuration from environment
// variables into a plain value — no package-level mutable state.
package config

import (
	"fmt"
	"os"
	"strconv"
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

	KafkaBrokers      []string
	KafkaWriteTimeout time.Duration
	ConsumerGroup     string

	// Own consumer group for the isolated ride.requested.v1.retry consumer
	// (see internal/reliability and docs/decisions/0007) — deliberately
	// separate from ConsumerGroup so a multi-minute retry backoff sleep
	// never blocks the main topic's partition.
	RetryConsumerGroup string

	// Geo-cell indexing (geohash — see docs/decisions/0005). Precision 6
	// gives roughly 1.2km x 0.61km cells: coarse enough that a handful of
	// neighbors covers a realistic pickup search radius, fine enough that
	// "candidates in this cell" stays a small, cheap Redis SMEMBERS call
	// even in a dense urban core.
	GeohashPrecision uint

	// A driver's location is ignored as a dispatch candidate once it's
	// older than this — independent of location-service's own Redis TTL
	// (5 min default), which governs "still shown as online at all", not
	// "fresh enough to route a ride to". Matching needs a much tighter
	// bound.
	StaleLocationAge time.Duration

	DriverProfileCacheTTL time.Duration

	OfferTTL            time.Duration
	MaxOfferAttempts    int
	ExpirySweepInterval time.Duration
}

func Load() (Config, error) {
	postgresDSN, err := requireEnv("DISPATCH_SERVICE_POSTGRES_DSN")
	if err != nil {
		return Config{}, err
	}

	cfg := Config{
		HTTPPort:            getEnv("HTTP_PORT", "8082"),
		HTTPReadTimeout:     getDuration("HTTP_READ_TIMEOUT", 5*time.Second),
		HTTPWriteTimeout:    getDuration("HTTP_WRITE_TIMEOUT", 5*time.Second),
		HTTPIdleTimeout:     getDuration("HTTP_IDLE_TIMEOUT", 60*time.Second),
		HTTPShutdownTimeout: getDuration("HTTP_SHUTDOWN_TIMEOUT", 10*time.Second),

		PostgresDSN:          postgresDSN,
		PostgresQueryTimeout: getDuration("POSTGRES_QUERY_TIMEOUT", 2*time.Second),

		RedisAddr:           getEnv("REDIS_ADDR", "127.0.0.1:63790"),
		RedisPassword:       getEnv("REDIS_PASSWORD", ""),
		RedisCommandTimeout: getDuration("REDIS_COMMAND_TIMEOUT", 1*time.Second),

		KafkaBrokers:      splitCSV(getEnv("KAFKA_BOOTSTRAP_SERVERS", "127.0.0.1:9094")),
		KafkaWriteTimeout: getDuration("KAFKA_WRITE_TIMEOUT", 5*time.Second),
		ConsumerGroup:     getEnv("DISPATCH_CONSUMER_GROUP", "dispatch-service"),

		RetryConsumerGroup: getEnv("DISPATCH_RETRY_CONSUMER_GROUP", "dispatch-service-retry"),

		GeohashPrecision: uint(getInt("GEOHASH_PRECISION", 6)),
		StaleLocationAge: getDuration("STALE_LOCATION_AGE", 60*time.Second),

		DriverProfileCacheTTL: getDuration("DRIVER_PROFILE_CACHE_TTL", 30*time.Second),

		OfferTTL:            getDuration("OFFER_TTL", 15*time.Second),
		MaxOfferAttempts:    getInt("MAX_OFFER_ATTEMPTS", 5),
		ExpirySweepInterval: getDuration("EXPIRY_SWEEP_INTERVAL", 2*time.Second),
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

func getInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
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
