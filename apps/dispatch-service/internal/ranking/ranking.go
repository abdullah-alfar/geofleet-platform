// Package ranking scores and orders candidate drivers for a ride request.
// Kept behind an interface (per the brief) so the strategy can be swapped
// without touching internal/matching — e.g. a future ML-based ranker, or
// one that calls a real routing engine for actual ETA.
//
// The brief lists "estimated arrival time" as a candidate ranking input
// alongside distance. This package doesn't compute a separate ETA figure —
// with no routing engine, ETA reduces to a monotonic function of
// straight-line distance anyway (same assumed speed for every candidate in
// the same local area), so it would just duplicate the distance factor
// under a different name. The distance factor stands in for it. A future
// Ranker implementation backed by a real routing engine is exactly the
// kind of swap this interface exists to make cheap.
package ranking

import (
	"sort"

	"dispatch-service/internal/types"
)

// Ranker orders candidates best-first.
type Ranker interface {
	Rank(candidates []types.Candidate) []types.Candidate
}

// WeightedRanker combines four normalized factors (each 0..1, higher is
// better) into a single weighted score. Weights sum to 1.0 by convention,
// though nothing enforces that — they're relative, not absolute.
type WeightedRanker struct {
	DistanceWeight       float64 // closer is better — the dominant factor by default
	RatingWeight         float64
	AcceptanceRateWeight float64
	IdleWeight           float64 // longer-idle drivers get a small boost, for fairness
}

// NewDefaultWeightedRanker returns the brief's suggested ranking inputs
// (distance, rating, acceptance rate, idle time) with distance weighted
// most heavily — the single factor riders feel most directly (pickup ETA).
func NewDefaultWeightedRanker() *WeightedRanker {
	return &WeightedRanker{
		DistanceWeight:       0.5,
		RatingWeight:         0.2,
		AcceptanceRateWeight: 0.2,
		IdleWeight:           0.1,
	}
}

func (r *WeightedRanker) Rank(candidates []types.Candidate) []types.Candidate {
	if len(candidates) <= 1 {
		return candidates
	}

	maxDistance, maxIdle := 0.0, 0.0
	for _, c := range candidates {
		if c.DistanceMeters > maxDistance {
			maxDistance = c.DistanceMeters
		}
		if c.IdleSeconds > maxIdle {
			maxIdle = c.IdleSeconds
		}
	}

	type scored struct {
		candidate types.Candidate
		score     float64
	}

	results := make([]scored, len(candidates))
	for i, c := range candidates {
		distanceScore := 1.0
		if maxDistance > 0 {
			distanceScore = 1 - (c.DistanceMeters / maxDistance) // closer -> higher
		}

		ratingScore := c.RatingOrDefault / 5.0 // ratings are 1..5
		acceptanceScore := c.AcceptanceRate    // already 0..1

		idleScore := 0.0
		if maxIdle > 0 {
			idleScore = c.IdleSeconds / maxIdle
		}

		results[i] = scored{
			candidate: c,
			score: r.DistanceWeight*distanceScore +
				r.RatingWeight*ratingScore +
				r.AcceptanceRateWeight*acceptanceScore +
				r.IdleWeight*idleScore,
		}
	}

	sort.Slice(results, func(i, j int) bool { return results[i].score > results[j].score })

	ranked := make([]types.Candidate, len(results))
	for i, r := range results {
		ranked[i] = r.candidate
	}
	return ranked
}
