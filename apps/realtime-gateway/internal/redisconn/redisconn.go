// Package redisconn provides the one Redis connection realtime-gateway
// needs — shared by internal/hub (Pub/Sub fan-out) and
// internal/relaystate (the two small correlation mappings), same as every
// other Go service in this platform uses a single client for its Redis
// needs.
package redisconn

import (
	"context"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

func Connect(ctx context.Context, addr, password string, commandTimeout time.Duration) (*redis.Client, error) {
	client := redis.NewClient(&redis.Options{
		Addr:         addr,
		Password:     password,
		DialTimeout:  commandTimeout,
		ReadTimeout:  commandTimeout,
		WriteTimeout: commandTimeout,
	})
	if err := client.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redisconn: ping: %w", err)
	}
	return client, nil
}
