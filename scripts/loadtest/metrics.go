// Minimal Prometheus text-exposition-format reader. Not a general-purpose
// parser — just enough to read this platform's own simple, well-known
// registries (see each service's internal/metrics package) and diff two
// snapshots taken before/after a load run. Deliberately dependency-free:
// pulling in a real Prometheus client library for a one-off diff tool
// would be a lot of weight for what's a few dozen lines of regex.
package main

import (
	"bufio"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strconv"
	"strings"
)

// snapshot maps the exact metric line ("name{labels}" or bare "name") to
// its value, so histogram bucket lines (which differ only by their le=
// label) each get their own entry.
type snapshot map[string]float64

func scrapeMetrics(url string) (snapshot, error) {
	resp, err := http.Get(url)
	if err != nil {
		return nil, fmt.Errorf("scrape %s: %w", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("scrape %s: HTTP %d", url, resp.StatusCode)
	}

	out := snapshot{}
	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		idx := strings.LastIndex(line, " ")
		if idx < 0 {
			continue
		}
		key := line[:idx]
		val, err := strconv.ParseFloat(line[idx+1:], 64)
		if err != nil {
			continue // e.g. "Nan"/timestamps on the same line — skip rather than fail the whole scrape
		}
		out[key] = val
	}
	return out, nil
}

// counterDelta sums the after-before diff across every series whose key
// starts with metricName (covers both bare counters and *Vec counters
// with labels — e.g. realtime_gateway_kafka_events_relayed_total{event_type="..."}).
func counterDelta(before, after snapshot, metricName string) float64 {
	var total float64
	for key, afterVal := range after {
		if key != metricName && !strings.HasPrefix(key, metricName+"{") {
			continue
		}
		total += afterVal - before[key] // before[key] is 0 if absent, which is correct for a new label combination
	}
	return total
}

type histogramSummary struct {
	Count float64
	Sum   float64
	P50   float64
	P95   float64
	P99   float64
}

// histogramDelta computes the diffed count/sum and approximate quantiles
// (linear interpolation between bucket boundaries — the same approach
// PromQL's histogram_quantile uses) for one histogram metric between two
// snapshots.
func histogramDelta(before, after snapshot, metricName string) histogramSummary {
	type bucket struct {
		le    float64
		count float64
	}
	var buckets []bucket

	prefix := metricName + "_bucket{"
	for key, afterVal := range after {
		if !strings.HasPrefix(key, prefix) {
			continue
		}
		le, ok := extractLabel(key, "le")
		if !ok {
			continue
		}
		leVal := le
		if le == "+Inf" {
			leVal = "" // handled below
		}
		diff := afterVal - before[key]
		if diff < 0 {
			diff = 0 // counter reset (service restarted mid-run) — clamp rather than report nonsense
		}
		var leFloat float64
		if leVal == "" {
			leFloat = math.Inf(1)
		} else {
			leFloat, _ = strconv.ParseFloat(leVal, 64)
		}
		buckets = append(buckets, bucket{le: leFloat, count: diff})
	}
	sort.Slice(buckets, func(i, j int) bool { return buckets[i].le < buckets[j].le })

	// Buckets are cumulative in Prometheus's exposition format already
	// (le="0.1" includes everything le="0.05" counted too), so no running
	// total needs to be built — sum here is only ever taken from the
	// +Inf bucket, which already IS the grand total.
	var total float64
	if len(buckets) > 0 {
		total = buckets[len(buckets)-1].count
	}

	sumKey := metricName + "_sum"
	countKey := metricName + "_count"
	sumDelta := after[sumKey] - before[sumKey]
	countDelta := after[countKey] - before[countKey]

	quantile := func(q float64) float64 {
		if total == 0 {
			return 0
		}
		target := q * total
		var prevLe, prevCount float64
		for _, b := range buckets {
			if b.count >= target {
				if b.count == prevCount {
					return prevLe
				}
				if isInf(b.le) {
					return prevLe // can't estimate past the highest finite bucket
				}
				frac := (target - prevCount) / (b.count - prevCount)
				return prevLe + frac*(b.le-prevLe)
			}
			prevLe, prevCount = b.le, b.count
		}
		return prevLe
	}

	return histogramSummary{
		Count: countDelta,
		Sum:   sumDelta,
		P50:   quantile(0.50),
		P95:   quantile(0.95),
		P99:   quantile(0.99),
	}
}

func extractLabel(metricLine, label string) (string, bool) {
	needle := label + `="`
	idx := strings.Index(metricLine, needle)
	if idx < 0 {
		return "", false
	}
	rest := metricLine[idx+len(needle):]
	end := strings.Index(rest, `"`)
	if end < 0 {
		return "", false
	}
	return rest[:end], true
}

func isInf(f float64) bool { return math.IsInf(f, 1) }
