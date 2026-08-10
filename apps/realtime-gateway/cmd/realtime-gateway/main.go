// Command realtime-gateway pushes ride-lifecycle events over WebSocket
// instead of leaving drivers/customers to poll: ride.offer.created.v1 to
// the offered driver, ride.assigned.v1 / ride.unavailable.v1 and the
// assigned driver's live location to the customer. It's consume-only — no
// Kafka topic is published by this service — and holds no domain state of
// its own beyond two small TTL-bounded Redis correlation mappings. See
// docs/decisions/0006-realtime-gateway-fanout.md and internal/ package
// docs for each component's responsibilities.
package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"realtime-gateway/internal/auth"
	"realtime-gateway/internal/config"
	"realtime-gateway/internal/httpapi"
	"realtime-gateway/internal/hub"
	rgkafka "realtime-gateway/internal/kafka"
	"realtime-gateway/internal/logging"
	"realtime-gateway/internal/metrics"
	"realtime-gateway/internal/redisconn"
	"realtime-gateway/internal/relay"
	"realtime-gateway/internal/relaystate"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "realtime-gateway:", err)
		os.Exit(1)
	}
}

func run() error {
	cfg, err := config.Load()
	if err != nil {
		return fmt.Errorf("load config: %w", err)
	}

	logger := logging.New(os.Getenv("LOG_LEVEL"))
	m := metrics.New()

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pgPool, err := auth.Connect(ctx, cfg.PostgresDSN)
	if err != nil {
		return fmt.Errorf("connect postgres: %w", err)
	}
	defer pgPool.Close()

	redisClient, err := redisconn.Connect(ctx, cfg.RedisAddr, cfg.RedisPassword, cfg.RedisCommandTimeout)
	if err != nil {
		return fmt.Errorf("connect redis: %w", err)
	}
	defer redisClient.Close()

	authStore := auth.New(pgPool)
	state := relaystate.New(redisClient, cfg.RideCorrelationTTL, cfg.DriverAssignmentTTL)
	h := hub.New(redisClient, m, logger)
	go h.Run(ctx)

	consumer, err := rgkafka.NewConsumer(
		cfg.KafkaBrokers,
		cfg.ConsumerGroup,
		[]string{
			"ride.requested.v1",
			"ride.offer.created.v1",
			"ride.assigned.v1",
			"ride.unavailable.v1",
			"driver.location.validated.v1",
		},
		map[string]rgkafka.HandlerFunc{
			"ride.requested.v1":            relay.NewRideRequestedHandler(state, logger),
			"ride.offer.created.v1":        relay.NewOfferCreatedHandler(h, m, logger),
			"ride.assigned.v1":             relay.NewRideAssignedHandler(state, h, m, logger),
			"ride.unavailable.v1":          relay.NewRideUnavailableHandler(state, h, m, logger),
			"driver.location.validated.v1": relay.NewDriverLocationHandler(state, h, m, logger),
		},
		logger,
	)
	if err != nil {
		return fmt.Errorf("create kafka consumer: %w", err)
	}
	defer consumer.Close()
	go consumer.Run(ctx)

	wsHandler := httpapi.NewWSHandler(authStore, h, ctx, cfg.PingInterval, cfg.PongTimeout, m, logger)
	healthHandler := httpapi.NewHealthHandler(map[string]httpapi.Pinger{
		"postgres": pgPool,
		"redis": httpapi.PingerFunc(func(ctx context.Context) error {
			return redisClient.Ping(ctx).Err()
		}),
	}, 2*time.Second)

	server := httpapi.NewServer(
		httpapi.ServerConfig{
			Port:         cfg.HTTPPort,
			ReadTimeout:  cfg.HTTPReadTimeout,
			WriteTimeout: cfg.HTTPWriteTimeout,
			IdleTimeout:  cfg.HTTPIdleTimeout,
		},
		wsHandler,
		healthHandler,
		m.Handler(),
		logger,
	)

	serverErr := make(chan error, 1)
	go func() {
		logger.Info("http server starting", "port", cfg.HTTPPort)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
			return
		}
		serverErr <- nil
	}()

	select {
	case err := <-serverErr:
		if err != nil {
			return fmt.Errorf("http server: %w", err)
		}
	case <-ctx.Done():
		logger.Info("shutdown signal received, draining connections")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), cfg.HTTPShutdownTimeout)
	defer cancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", "error", err)
		return err
	}

	logger.Info("shutdown complete")
	return nil
}
