// Command location-service ingests driver GPS updates over HTTP, validates
// them, publishes valid events to Kafka, and keeps the latest known
// location per driver in Redis. See the package docs under internal/ for
// each component's responsibilities.
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

	"location-service/internal/config"
	"location-service/internal/devicecache"
	"location-service/internal/devicestore"
	"location-service/internal/httpapi"
	"location-service/internal/kafka"
	"location-service/internal/logging"
	"location-service/internal/metrics"
	"location-service/internal/redisstore"
	"location-service/internal/validation"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "location-service:", err)
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

	// ctx is cancelled on SIGINT/SIGTERM and threaded through every
	// long-lived component's setup so startup itself can be interrupted,
	// not just the running server.
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pgPool, err := devicestore.Connect(ctx, cfg.PostgresDSN)
	if err != nil {
		return fmt.Errorf("connect postgres: %w", err)
	}
	defer pgPool.Close()

	redisClient, err := redisstore.Connect(ctx, cfg.RedisAddr, cfg.RedisPassword, cfg.RedisCommandTimeout)
	if err != nil {
		return fmt.Errorf("connect redis: %w", err)
	}
	defer redisClient.Close()

	publisher, err := kafka.NewFranzPublisher(cfg.KafkaBrokers, cfg.KafkaWriteTimeout)
	if err != nil {
		return fmt.Errorf("connect kafka: %w", err)
	}
	defer publisher.Close()

	store := devicestore.New(pgPool)
	cache := devicecache.New(store, cfg.DeviceCacheTTL)
	go cache.Run(ctx)

	validator := validation.New(validation.Config{
		MaxAccuracyMeters:   cfg.MaxAccuracyMeters,
		MaxTimestampAge:     cfg.MaxTimestampAge,
		MaxFutureSkew:       cfg.MaxFutureSkew,
		MaxPlausibleSpeedMS: cfg.MaxPlausibleSpeedMS,
	})

	locationStore := redisstore.New(redisClient, cfg.LocationTTL, cfg.RateLimitWindow, cfg.MaxUpdatesPerWindow)

	locationHandler := httpapi.NewLocationHandler(validator, locationStore, publisher, m, logger)

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
		locationHandler,
		healthHandler,
		m.Handler(),
		cache,
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
