// Package metrics defines dispatch-service's Prometheus metrics. A Metrics
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

	RideRequestsReceived prometheus.Counter
	MatchingDuration     prometheus.Histogram
	CandidatesFound      prometheus.Histogram
	OffersCreated        prometheus.Counter
	OffersAccepted       prometheus.Counter
	OffersRejected       prometheus.Counter
	OffersExpired        prometheus.Counter
	RidesUnavailable     prometheus.Counter
	KafkaPublishErrors   prometheus.Counter
	AuthFailures         prometheus.Counter
}

func New() *Metrics {
	registry := prometheus.NewRegistry()

	m := &Metrics{
		registry: registry,

		RideRequestsReceived: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dispatch_service_ride_requests_received_total",
			Help: "Total ride.requested.v1 events consumed.",
		}),
		MatchingDuration: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "dispatch_service_matching_duration_seconds",
			Help:    "Time to run one matching cycle (candidate search through offer creation or unavailable).",
			Buckets: prometheus.DefBuckets,
		}),
		CandidatesFound: prometheus.NewHistogram(prometheus.HistogramOpts{
			Name:    "dispatch_service_candidates_found",
			Help:    "Number of eligible candidate drivers found per matching cycle.",
			Buckets: []float64{0, 1, 2, 3, 5, 10, 20, 50},
		}),
		OffersCreated: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dispatch_service_offers_created_total",
			Help: "Total ride offers created.",
		}),
		OffersAccepted: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dispatch_service_offers_accepted_total",
			Help: "Total ride offers accepted by a driver.",
		}),
		OffersRejected: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dispatch_service_offers_rejected_total",
			Help: "Total ride offers explicitly rejected by a driver.",
		}),
		OffersExpired: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dispatch_service_offers_expired_total",
			Help: "Total ride offers that timed out unanswered.",
		}),
		RidesUnavailable: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dispatch_service_rides_unavailable_total",
			Help: "Total ride requests that ended with no driver assigned.",
		}),
		KafkaPublishErrors: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dispatch_service_kafka_publish_errors_total",
			Help: "Errors publishing ride.* events to Kafka.",
		}),
		AuthFailures: prometheus.NewCounter(prometheus.CounterOpts{
			Name: "dispatch_service_device_auth_failures_total",
			Help: "HTTP requests rejected due to unknown/invalid device credentials.",
		}),
	}

	registry.MustRegister(
		m.RideRequestsReceived, m.MatchingDuration, m.CandidatesFound,
		m.OffersCreated, m.OffersAccepted, m.OffersRejected, m.OffersExpired,
		m.RidesUnavailable, m.KafkaPublishErrors, m.AuthFailures,
	)

	return m
}

func (m *Metrics) Handler() http.Handler {
	return promhttp.HandlerFor(m.registry, promhttp.HandlerOpts{})
}
