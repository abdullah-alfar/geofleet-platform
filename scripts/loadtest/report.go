package main

import (
	"fmt"
	"time"
)

type serviceSnapshots map[string]snapshot // keyed by service name

func scrapeAll(cfg config) serviceSnapshots {
	out := serviceSnapshots{}
	targets := map[string]string{
		"location-service": cfg.locationService + "/metrics",
		"dispatch-service": cfg.dispatchService + "/metrics",
		"realtime-gateway": cfg.realtimeGateway + "/metrics", // optional, may not be running
	}
	for name, url := range targets {
		snap, err := scrapeMetrics(url)
		if err != nil {
			fmt.Printf("  (skipping %s metrics: %v)\n", name, err)
			continue
		}
		out[name] = snap
	}
	return out
}

func printReport(before, after serviceSnapshots, gpsElapsed, rideElapsed time.Duration) {
	fmt.Println()
	fmt.Println("=== Capacity report (deltas over this run, from each service's own Prometheus metrics) ===")

	if b, ok := before["location-service"]; ok {
		if a, ok := after["location-service"]; ok {
			fmt.Println()
			fmt.Println("-- location-service (GPS ingestion) --")
			received := counterDelta(b, a, "location_service_gps_updates_received_total")
			accepted := counterDelta(b, a, "location_service_gps_updates_accepted_total")
			rejected := counterDelta(b, a, "location_service_gps_validation_rejections_total")
			fmt.Printf("  received=%.0f accepted=%.0f rejected=%.0f (%.1f%% accepted)\n",
				received, accepted, rejected, safePct(accepted, received))
			fmt.Printf("  throughput: %.1f updates/sec over %s\n", received/gpsElapsed.Seconds(), gpsElapsed.Round(time.Second))
			printHistogram("ingestion latency", b, a, "location_service_ingestion_duration_seconds")
			printHistogram("kafka publish latency", b, a, "location_service_kafka_publish_duration_seconds")
		}
	}

	if b, ok := before["dispatch-service"]; ok {
		if a, ok := after["dispatch-service"]; ok {
			fmt.Println()
			fmt.Println("-- dispatch-service (matching) --")
			rideRequests := counterDelta(b, a, "dispatch_service_ride_requests_received_total")
			offersCreated := counterDelta(b, a, "dispatch_service_offers_created_total")
			offersAccepted := counterDelta(b, a, "dispatch_service_offers_accepted_total")
			unavailable := counterDelta(b, a, "dispatch_service_rides_unavailable_total")
			publishErrors := counterDelta(b, a, "dispatch_service_kafka_publish_errors_total")
			fmt.Printf("  ride.requested.v1 consumed=%.0f offers_created=%.0f offers_accepted=%.0f unavailable=%.0f kafka_publish_errors=%.0f\n",
				rideRequests, offersCreated, offersAccepted, unavailable, publishErrors)
			printHistogram("matching cycle latency", b, a, "dispatch_service_matching_duration_seconds")
			printHistogram("candidates found per cycle", b, a, "dispatch_service_candidates_found")
		}
	}

	if b, ok := before["realtime-gateway"]; ok {
		if a, ok := after["realtime-gateway"]; ok {
			fmt.Println()
			fmt.Println("-- realtime-gateway (fan-out) --")
			relayed := counterDelta(b, a, "realtime_gateway_kafka_events_relayed_total")
			redisErrors := counterDelta(b, a, "realtime_gateway_redis_publish_errors_total")
			wsErrors := counterDelta(b, a, "realtime_gateway_ws_send_errors_total")
			fmt.Printf("  events_relayed=%.0f redis_publish_errors=%.0f ws_send_errors=%.0f\n", relayed, redisErrors, wsErrors)
		}
	}

	fmt.Println()
	fmt.Printf("ride-request burst wall time: %s\n", rideElapsed.Round(time.Millisecond))
	fmt.Println()
	fmt.Println("See docs/architecture/scalability.md for how these numbers are interpreted.")
}

func printHistogram(label string, before, after snapshot, metricName string) {
	h := histogramDelta(before, after, metricName)
	if h.Count == 0 {
		fmt.Printf("  %s: no samples\n", label)
		return
	}
	avg := h.Sum / h.Count
	fmt.Printf("  %s: n=%.0f avg=%.4f p50=%.4f p95=%.4f p99=%.4f\n", label, h.Count, avg, h.P50, h.P95, h.P99)
}

func safePct(part, total float64) float64 {
	if total == 0 {
		return 0
	}
	return 100 * part / total
}
