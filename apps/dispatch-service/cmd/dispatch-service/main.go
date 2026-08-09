// Command dispatch-service matches ride requests to nearby available
// drivers: it maintains a Redis geohash index of available drivers (from
// driver.location.validated.v1 / driver.status.changed.v1), runs a
// matching cycle on ride.requested.v1, creates and expires ride offers,
// and exposes an HTTP surface for drivers to accept/reject them. See
// internal/ package docs for each component's responsibilities.
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

	"dispatch-service/internal/config"
	"dispatch-service/internal/driverindex"
	"dispatch-service/internal/driverprofile"
	"dispatch-service/internal/expiry"
	"dispatch-service/internal/httpapi"
	"dispatch-service/internal/indexconsumers"
	dispatchkafka "dispatch-service/internal/kafka"
	"dispatch-service/internal/logging"
	"dispatch-service/internal/matching"
	"dispatch-service/internal/metrics"
	"dispatch-service/internal/offers"
	"dispatch-service/internal/offerstore"
	"dispatch-service/internal/ranking"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "dispatch-service:", err)
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

	pgPool, err := driverprofile.Connect(ctx, cfg.PostgresDSN)
	if err != nil {
		return fmt.Errorf("connect postgres: %w", err)
	}
	defer pgPool.Close()

	redisClient, err := driverindex.Connect(ctx, cfg.RedisAddr, cfg.RedisPassword, cfg.RedisCommandTimeout)
	if err != nil {
		return fmt.Errorf("connect redis: %w", err)
	}
	defer redisClient.Close()

	publisher, err := dispatchkafka.NewFranzPublisher(cfg.KafkaBrokers, cfg.KafkaWriteTimeout)
	if err != nil {
		return fmt.Errorf("connect kafka producer: %w", err)
	}
	defer publisher.Close()

	index := driverindex.New(redisClient, cfg.GeohashPrecision)
	profileStore := driverprofile.New(pgPool)
	profiles := driverprofile.NewCached(profileStore, cfg.DriverProfileCacheTTL)
	go profiles.Profiles.Run(ctx)
	go profiles.Devices.Run(ctx)

	offerStore := offerstore.New(pgPool)
	ranker := ranking.NewDefaultWeightedRanker()

	matcher := matching.New(index, profiles, offerStore, publisher, ranker, matching.Config{
		GeohashPrecision: cfg.GeohashPrecision,
		StaleLocationAge: cfg.StaleLocationAge,
		OfferTTL:         cfg.OfferTTL,
		MaxOfferAttempts: cfg.MaxOfferAttempts,
	}, logger, m)

	offerService := offers.New(offerStore, index, matcher, publisher, m, logger)

	sweeper := expiry.New(offerStore, matcher, cfg.ExpirySweepInterval, m, logger)
	go sweeper.Run(ctx)

	consumer, err := dispatchkafka.NewConsumer(
		cfg.KafkaBrokers,
		cfg.ConsumerGroup,
		[]string{"driver.location.validated.v1", "driver.status.changed.v1", "ride.requested.v1"},
		map[string]dispatchkafka.HandlerFunc{
			"driver.location.validated.v1": indexconsumers.NewLocationHandler(index, logger),
			"driver.status.changed.v1":     indexconsumers.NewStatusHandler(index, logger),
			"ride.requested.v1":            matching.NewRideRequestedHandler(matcher, logger),
		},
		logger,
	)
	if err != nil {
		return fmt.Errorf("create kafka consumer: %w", err)
	}
	defer consumer.Close()
	go consumer.Run(ctx)

	offerHandler := httpapi.NewOfferHandler(offerService, offerStore, logger)
	healthHandler := httpapi.NewHealthHandler(map[string]httpapi.Pinger{
		"postgres": pgPool,
		"kafka":    publisher,
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
		offerHandler,
		healthHandler,
		m.Handler(),
		profiles,
		m,
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
		logger.Info("shutdown signal received, draining in-flight requests")
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
