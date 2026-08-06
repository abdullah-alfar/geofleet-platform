// Package config loads location-service's configuration from environment
// variables. Nothing here is a package-level mutable variable — Load
// returns a Config value that callers pass down via constructors.
package config

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	// HTTP server
	HTTPPort            string
	HTTPReadTimeout     time.Duration
	HTTPWriteTimeout    time.Duration
	HTTPIdleTimeout     time.Duration
	HTTPShutdownTimeout time.Duration

	// Postgres (least-privilege location_service role — see
	// apps/core-api database/migrations/*_create_location_service_role.php)
	PostgresDSN          string
	PostgresQueryTimeout time.Duration

	// Redis
	RedisAddr           string
	RedisPassword       string
	RedisCommandTimeout time.Duration

	// Kafka
	KafkaBrokers      []string
	KafkaWriteTimeout time.Duration

	// Device identity cache
	DeviceCacheTTL time.Duration

	// GPS validation thresholds
	MaxAccuracyMeters   float64
	MaxTimestampAge     time.Duration
	MaxFutureSkew       time.Duration
	MaxPlausibleSpeedMS float64
	MaxUpdatesPerWindow int
	RateLimitWindow     time.Duration

	// Latest-location TTL in Redis: how long a driver is considered
	// "online" without a fresh update.
	LocationTTL time.Duration
}

func Load() (Config, error) {
	postgresDSN, err := requireEnv("LOCATION_SERVICE_POSTGRES_DSN")
	if err != nil {
		return Config{}, err
	}

	redisAddr := getEnv("REDIS_ADDR", "127.0.0.1:63790")
	kafkaBrokers := getEnv("KAFKA_BOOTSTRAP_SERVERS", "127.0.0.1:9094")

	cfg := Config{
		HTTPPort:            getEnv("HTTP_PORT", "8081"),
		HTTPReadTimeout:     getDuration("HTTP_READ_TIMEOUT", 5*time.Second),
		HTTPWriteTimeout:    getDuration("HTTP_WRITE_TIMEOUT", 5*time.Second),
		HTTPIdleTimeout:     getDuration("HTTP_IDLE_TIMEOUT", 60*time.Second),
		HTTPShutdownTimeout: getDuration("HTTP_SHUTDOWN_TIMEOUT", 10*time.Second),

		PostgresDSN:          postgresDSN,
		PostgresQueryTimeout: getDuration("POSTGRES_QUERY_TIMEOUT", 2*time.Second),

		RedisAddr:           redisAddr,
		RedisPassword:       getEnv("REDIS_PASSWORD", ""),
		RedisCommandTimeout: getDuration("REDIS_COMMAND_TIMEOUT", 1*time.Second),

		KafkaBrokers:      splitCSV(kafkaBrokers),
		KafkaWriteTimeout: getDuration("KAFKA_WRITE_TIMEOUT", 5*time.Second),

		DeviceCacheTTL: getDuration("DEVICE_CACHE_TTL", 30*time.Second),

		MaxAccuracyMeters:   getFloat("MAX_ACCURACY_METERS", 100),
		MaxTimestampAge:     getDuration("MAX_TIMESTAMP_AGE", 120*time.Second),
		MaxFutureSkew:       getDuration("MAX_FUTURE_SKEW", 10*time.Second),
		MaxPlausibleSpeedMS: getFloat("MAX_PLAUSIBLE_SPEED_MS", 60), // ~216 km/h
		MaxUpdatesPerWindow: getInt("MAX_UPDATES_PER_WINDOW", 2),
		RateLimitWindow:     getDuration("RATE_LIMIT_WINDOW", 1*time.Second),

		LocationTTL: getDuration("LOCATION_TTL", 5*time.Minute),
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

func getFloat(key string, fallback float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f
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
