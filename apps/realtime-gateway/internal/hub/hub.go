// Package hub is realtime-gateway's fan-out layer: it holds this
// instance's local WebSocket connections and relays messages to them via
// Redis Pub/Sub, so delivery works correctly no matter which
// realtime-gateway instance's Kafka consumer happened to receive the
// triggering event. See docs/decisions/0006-realtime-gateway-fanout.md.
//
// Every relay — even to a connection held by this same instance — goes
// through Redis. That's a deliberate simplification: one code path
// regardless of topology, instead of a "local fast path" that would only
// get exercised (and only get tested) when running a single instance.
package hub

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/redis/go-redis/v9"

	"realtime-gateway/internal/metrics"
)

// Message is the JSON shape delivered both over Redis Pub/Sub and,
// unmodified, as the WebSocket frame sent to the client.
type Message struct {
	Type string `json:"type"`
	Data any    `json:"data"`
}

const channelPrefix = "rt:"

func DriverChannel(driverUUID string) string     { return channelPrefix + "driver:" + driverUUID }
func CustomerChannel(customerUUID string) string { return channelPrefix + "customer:" + customerUUID }

type Hub struct {
	redis   *redis.Client
	metrics *metrics.Metrics
	logger  *slog.Logger

	writeTimeout time.Duration

	mu        sync.Mutex
	drivers   map[string]*websocket.Conn
	customers map[string]*websocket.Conn
}

func New(redisClient *redis.Client, m *metrics.Metrics, logger *slog.Logger) *Hub {
	return &Hub{
		redis:        redisClient,
		metrics:      m,
		logger:       logger,
		writeTimeout: 5 * time.Second,
		drivers:      make(map[string]*websocket.Conn),
		customers:    make(map[string]*websocket.Conn),
	}
}

// RegisterDriver makes c the connection this instance will deliver
// rt:driver:{driverUUID} messages to. If a previous connection was
// registered for the same driver (e.g. an app restart that didn't cleanly
// close the old socket), it's closed — last connection wins, no zombie
// sockets accumulate.
func (h *Hub) RegisterDriver(driverUUID string, c *websocket.Conn) {
	h.mu.Lock()
	old, existed := h.drivers[driverUUID]
	h.drivers[driverUUID] = c
	h.mu.Unlock()

	if existed {
		_ = old.Close(websocket.StatusPolicyViolation, "replaced by a new connection")
	} else {
		h.metrics.DriverConnectionsActive.Inc()
	}
}

func (h *Hub) UnregisterDriver(driverUUID string, c *websocket.Conn) {
	h.mu.Lock()
	current, ok := h.drivers[driverUUID]
	if ok && current == c {
		delete(h.drivers, driverUUID)
	}
	h.mu.Unlock()

	if ok && current == c {
		h.metrics.DriverConnectionsActive.Dec()
	}
}

func (h *Hub) RegisterCustomer(customerUUID string, c *websocket.Conn) {
	h.mu.Lock()
	old, existed := h.customers[customerUUID]
	h.customers[customerUUID] = c
	h.mu.Unlock()

	if existed {
		_ = old.Close(websocket.StatusPolicyViolation, "replaced by a new connection")
	} else {
		h.metrics.CustomerConnectionsActive.Inc()
	}
}

func (h *Hub) UnregisterCustomer(customerUUID string, c *websocket.Conn) {
	h.mu.Lock()
	current, ok := h.customers[customerUUID]
	if ok && current == c {
		delete(h.customers, customerUUID)
	}
	h.mu.Unlock()

	if ok && current == c {
		h.metrics.CustomerConnectionsActive.Dec()
	}
}

// Publish hands a message to Redis for delivery on the given channel
// (DriverChannel/CustomerChannel). It does not check whether any instance
// currently holds a matching connection — Redis Pub/Sub simply delivers to
// no one if nobody's subscribed and listening for that id, which is the
// correct behavior (e.g. a driver who's offline).
func (h *Hub) Publish(ctx context.Context, channel string, msg Message) error {
	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("hub: marshal message: %w", err)
	}
	if err := h.redis.Publish(ctx, channel, payload).Err(); err != nil {
		h.metrics.RedisPublishErrors.Inc()
		return fmt.Errorf("hub: publish to %s: %w", channel, err)
	}
	return nil
}

// Run subscribes to every rt:* channel and forwards each message to the
// matching local connection, if this instance holds one. Blocks until ctx
// is cancelled.
func (h *Hub) Run(ctx context.Context) {
	pubsub := h.redis.PSubscribe(ctx, channelPrefix+"*")
	defer pubsub.Close()

	ch := pubsub.Channel()
	for {
		select {
		case <-ctx.Done():
			return
		case redisMsg, ok := <-ch:
			if !ok {
				return
			}
			h.deliver(ctx, redisMsg)
		}
	}
}

func (h *Hub) deliver(ctx context.Context, redisMsg *redis.Message) {
	kind, id, ok := parseChannel(redisMsg.Channel)
	if !ok {
		return
	}

	h.mu.Lock()
	var conn *websocket.Conn
	switch kind {
	case "driver":
		conn = h.drivers[id]
	case "customer":
		conn = h.customers[id]
	}
	h.mu.Unlock()

	if conn == nil {
		return // nobody local holds this connection right now
	}

	var msg Message
	if err := json.Unmarshal([]byte(redisMsg.Payload), &msg); err != nil {
		h.logger.Error("hub: malformed relay message, dropping", "channel", redisMsg.Channel, "error", err)
		return
	}

	writeCtx, cancel := context.WithTimeout(ctx, h.writeTimeout)
	defer cancel()

	if err := wsjson.Write(writeCtx, conn, msg); err != nil {
		h.metrics.WSSendErrors.Inc()
		h.logger.Warn("hub: failed to deliver to local connection, closing it", "kind", kind, "id", id, "error", err)
		_ = conn.Close(websocket.StatusInternalError, "delivery failed")
	}
}

func parseChannel(channel string) (kind, id string, ok bool) {
	const driverPrefix = channelPrefix + "driver:"
	const customerPrefix = channelPrefix + "customer:"

	switch {
	case len(channel) > len(driverPrefix) && channel[:len(driverPrefix)] == driverPrefix:
		return "driver", channel[len(driverPrefix):], true
	case len(channel) > len(customerPrefix) && channel[:len(customerPrefix)] == customerPrefix:
		return "customer", channel[len(customerPrefix):], true
	default:
		return "", "", false
	}
}
