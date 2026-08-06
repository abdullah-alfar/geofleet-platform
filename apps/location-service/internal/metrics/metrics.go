// Package metrics defines location-service's Prometheus metrics. A Metrics
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

	UpdatesReceived      prometheus.Counter
	UpdatesAccepted      prometheus.Counter
	ValidationRejections *prometheus.CounterVec
	AuthFailures         prometheus.Counter
	IngestionDuration    prometheus.Histogram
	KafkaPublishErrors   prometheus.Counter
	KafkaPublishDuration prometheus.Histogram
}

func New() *Metrics {
	registry := prometheus.NewRegistry()

	m := &Metrics{
		registry: registry,

		UpdatesReceived: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "location_service_gps_updates_received_total",
			Help: "Total GPS updates received over HTTP, before validation.",
		}),
		UpdatesAccepted: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "location_service_gps_updates_accepted_total",
			Help: "Total GPS updates that passed validation and were published/stored.",
		}),
		ValidationRejections: prometheus.NewCounterVec(prometheus.CounterOpts{
			Name: "location_service_gps_validation_rejections_total",
			Help: "GPS updates rejected by validation, labeled by reason.",
		}, []string{"reason"}),
		AuthFailures: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "location_service_device_auth_failures_total",
			Help: "Requests rejected due to unknown/invalid/revoked device credentials.",
		}),
		IngestionDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "location_service_ingestion_duration_seconds",
			Help:    "End-to-end handling time for a GPS update request.",
			Buckets: prometheus.DefBuckets,
		}),
		KafkaPublishErrors: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "location_service_kafka_publish_errors_total",
			Help: "Errors publishing validated GPS events to Kafka.",
		}),
		KafkaPublishDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "location_service_kafka_publish_duration_seconds",
			Help:    "Time spent publishing a GPS event to Kafka.",
			Buckets: prometheus.DefBuckets,
		}),
	}

	registry.MustRegister(
		m.UpdatesReceived,
		m.UpdatesAccepted,
		m.ValidationRejections,
		m.AuthFailures,
		m.IngestionDuration,
		m.KafkaPublishErrors,
		m.KafkaPublishDuration,
	)

	return m
}

// Handler exposes the metrics in Prometheus text format for GET /metrics.
func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}
