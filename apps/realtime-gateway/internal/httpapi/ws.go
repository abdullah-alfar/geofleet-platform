package httpapi

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/google/uuid"

	"realtime-gateway/internal/auth"
	"realtime-gateway/internal/hub"
	"realtime-gateway/internal/metrics"
)

// Authenticator is the subset of auth.Store this package depends on.
type Authenticator interface {
	AuthenticateDriver(ctx context.Context, rawToken string) (*auth.Driver, error)
	AuthenticateCustomer(ctx context.Context, bearerToken string) (*auth.Customer, error)
}

// WSHandler upgrades authenticated driver/customer requests to WebSocket
// connections and registers them with the hub for the duration of the
// connection. Both endpoints are otherwise identical — accept, register,
// keep alive with pings, unregister on close — they differ only in which
// credential they check and which hub registry they use.
type WSHandler struct {
	auth        Authenticator
	hub         *hub.Hub
	shutdownCtx context.Context

	pingInterval time.Duration
	pongTimeout  time.Duration

	metrics *metrics.Metrics
	logger  *slog.Logger
}

func NewWSHandler(authenticator Authenticator, h *hub.Hub, shutdownCtx context.Context, pingInterval, pongTimeout time.Duration, m *metrics.Metrics, logger *slog.Logger) *WSHandler {
	return &WSHandler{
		auth:         authenticator,
		hub:          h,
		shutdownCtx:  shutdownCtx,
		pingInterval: pingInterval,
		pongTimeout:  pongTimeout,
		metrics:      m,
		logger:       logger,
	}
}

// ServeDriver authenticates with the same device-token credential
// apps/location-service and apps/dispatch-service use, then streams
// ride.offer.created.v1 notifications to this driver in real time.
func (h *WSHandler) ServeDriver(w http.ResponseWriter, r *http.Request) {
	token, ok := bearerToken(r)
	if !ok {
		h.metrics.AuthFailures.Inc()
		writeError(w, http.StatusUnauthorized, "missing_or_malformed_authorization", "expected 'Authorization: Bearer <device_token>' or ?token=")
		return
	}

	driver, err := h.auth.AuthenticateDriver(r.Context(), token)
	if errors.Is(err, auth.ErrInvalidCredentials) {
		h.metrics.AuthFailures.Inc()
		writeError(w, http.StatusUnauthorized, "unknown_device", "device token not recognized or device/driver not active")
		return
	}
	if err != nil {
		h.logger.Error("driver ws: auth lookup failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "auth_unavailable", "could not verify device credentials")
		return
	}

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return // Accept already wrote the failure response
	}

	connID := uuid.NewString()
	h.logger.Info("driver ws connected", "driver_id", driver.DriverUUID, "connection_id", connID)
	h.hub.RegisterDriver(driver.DriverUUID, conn)

	h.serveConn(conn, hub.Message{Type: "connected", Data: map[string]string{"driver_id": driver.DriverUUID}})

	h.hub.UnregisterDriver(driver.DriverUUID, conn)
	h.logger.Info("driver ws disconnected", "driver_id", driver.DriverUUID, "connection_id", connID)
}

// ServeCustomer authenticates with the customer's existing Sanctum bearer
// token (the same one core-api's REST API accepts), then streams
// ride.assigned.v1 / ride.unavailable.v1 outcomes and their assigned
// driver's live location to this customer in real time.
func (h *WSHandler) ServeCustomer(w http.ResponseWriter, r *http.Request) {
	token, ok := bearerToken(r)
	if !ok {
		h.metrics.AuthFailures.Inc()
		writeError(w, http.StatusUnauthorized, "missing_or_malformed_authorization", "expected 'Authorization: Bearer <token>' or ?token=")
		return
	}

	customer, err := h.auth.AuthenticateCustomer(r.Context(), token)
	if errors.Is(err, auth.ErrInvalidCredentials) {
		h.metrics.AuthFailures.Inc()
		writeError(w, http.StatusUnauthorized, "invalid_token", "token not recognized, expired, or account not active")
		return
	}
	if err != nil {
		h.logger.Error("customer ws: auth lookup failed", "error", err)
		writeError(w, http.StatusServiceUnavailable, "auth_unavailable", "could not verify token")
		return
	}

	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}

	connID := uuid.NewString()
	h.logger.Info("customer ws connected", "customer_id", customer.CustomerUUID, "connection_id", connID)
	h.hub.RegisterCustomer(customer.CustomerUUID, conn)

	h.serveConn(conn, hub.Message{Type: "connected", Data: map[string]string{"customer_id": customer.CustomerUUID}})

	h.hub.UnregisterCustomer(customer.CustomerUUID, conn)
	h.logger.Info("customer ws disconnected", "customer_id", customer.CustomerUUID, "connection_id", connID)
}

// serveConn owns the connection until it closes: sends an initial ack,
// then pings on a ticker until the connection dies, the client closes it,
// or the service is shutting down. Actual message delivery happens
// out-of-band via hub.Run — this loop's only job is keepalive and
// noticing when to unregister.
func (h *WSHandler) serveConn(conn *websocket.Conn, ack hub.Message) {
	defer conn.CloseNow()

	// The client never sends application messages on this protocol —
	// CloseRead hands off reading so ping/pong/close control frames still
	// get handled, and gives us a context that's cancelled the moment the
	// connection actually closes.
	connCtx := conn.CloseRead(h.shutdownCtx)

	ackCtx, cancel := context.WithTimeout(connCtx, h.pongTimeout)
	_ = wsjson.Write(ackCtx, conn, ack)
	cancel()

	ticker := time.NewTicker(h.pingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-h.shutdownCtx.Done():
			_ = conn.Close(websocket.StatusServiceRestart, "server shutting down")
			return
		case <-connCtx.Done():
			return
		case <-ticker.C:
			pingCtx, cancel := context.WithTimeout(connCtx, h.pongTimeout)
			err := conn.Ping(pingCtx)
			cancel()
			if err != nil {
				return
			}
		}
	}
}

func bearerToken(r *http.Request) (string, bool) {
	if header := r.Header.Get("Authorization"); header != "" {
		const prefix = "Bearer "
		if strings.HasPrefix(header, prefix) {
			if token := strings.TrimSpace(strings.TrimPrefix(header, prefix)); token != "" {
				return token, true
			}
		}
	}

	// Query-param fallback: browser WebSocket clients cannot set custom
	// request headers on the upgrade request, so this is the only way a
	// browser-based app can authenticate. The token itself is unchanged
	// (same bearer credential, just relocated) — no new auth mechanism.
	if token := r.URL.Query().Get("token"); token != "" {
		return token, true
	}

	return "", false
}
