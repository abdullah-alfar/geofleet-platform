// Package metrics defines realtime-gateway's Prometheus metrics. A Metrics
// value owns its own registry (not the global default one) and is
// constructed once in main.go and passed down — no package-level state.
package metrics

import (
	"net/http"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

type Metrics struct {
	registry *prometheus.Registry

	DriverConnectionsActive   prometheus.Gauge
	CustomerConnectionsActive prometheus.Gauge
	AuthFailures              prometheus.Counter
	KafkaEventsRelayed        *prometheus.CounterVec
	RedisPublishErrors        prometheus.Counter
	WSSendErrors              prometheus.Counter
}

func New() *Metrics {
	registry := prometheus.NewRegistry()

	m := &Metrics{
		registry: registry,

		DriverConnectionsActive: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "realtime_gateway_driver_connections_active",
			Help: "Currently open driver WebSocket connections on this instance.",
		}),
		CustomerConnectionsActive: prometheus.NewGauge(prometheus.GaugeOpts{
			Name: "realtime_gateway_customer_connections_active",
			Help: "Currently open customer WebSocket connections on this instance.",
		}),
		AuthFailures: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "realtime_gateway_auth_failures_total",
			Help: "WebSocket upgrade attempts rejected due to invalid credentials.",
		}),
		KafkaEventsRelayed: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "realtime_gateway_kafka_events_relayed_total",
			Help: "Kafka events relayed to Redis, by event type.",
		}, []string{"event_type"}),
		RedisPublishErrors: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "realtime_gateway_redis_publish_errors_total",
			Help: "Errors publishing a relay message to Redis.",
		}),
		WSSendErrors: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "realtime_gateway_ws_send_errors_total",
			Help: "Errors writing to a local WebSocket connection (connection dropped and closed).",
		}),
	}

	registry.MustRegister(
		m.DriverConnectionsActive, m.CustomerConnectionsActive, m.AuthFailures,
		m.KafkaEventsRelayed, m.RedisPublishErrors, m.WSSendErrors,
	)

	return m
}

func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}
