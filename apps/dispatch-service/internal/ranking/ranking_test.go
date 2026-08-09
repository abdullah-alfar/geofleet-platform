package ranking

import (
	"testing"

	"dispatch-service/internal/types"
)

func TestWeightedRanker_ClosestWins(t *testing.T) {
	r := NewDefaultWeightedRanker()

	candidates := []types.Candidate{
		{DriverID: "far", DistanceMeters: 5000, RatingOrDefault: 5.0, AcceptanceRate: 1.0, IdleSeconds: 0},
		{DriverID: "near", DistanceMeters: 200, RatingOrDefault: 3.0, AcceptanceRate: 0.5, IdleSeconds: 0},
	}

	ranked := r.Rank(candidates)

	if ranked[0].DriverID != "near" {
		t.Fatalf("expected 'near' to rank first (distance dominates by default weight), got %s", ranked[0].DriverID)
	}
}

func TestWeightedRanker_TiebreakOnRatingAndAcceptance(t *testing.T) {
	r := NewDefaultWeightedRanker()

	candidates := []types.Candidate{
		{DriverID: "lower_rated", DistanceMeters: 500, RatingOrDefault: 3.0, AcceptanceRate: 0.5, IdleSeconds: 0},
		{DriverID: "higher_rated", DistanceMeters: 500, RatingOrDefault: 5.0, AcceptanceRate: 0.9, IdleSeconds: 0},
	}

	ranked := r.Rank(candidates)

	if ranked[0].DriverID != "higher_rated" {
		t.Fatalf("expected 'higher_rated' to win an equal-distance tiebreak, got %s", ranked[0].DriverID)
	}
}

func TestWeightedRanker_IdleTimeGivesFairnessBoost(t *testing.T) {
	r := NewDefaultWeightedRanker()

	candidates := []types.Candidate{
		{DriverID: "just_online", DistanceMeters: 500, RatingOrDefault: 4.0, AcceptanceRate: 0.8, IdleSeconds: 0},
		{DriverID: "long_idle", DistanceMeters: 500, RatingOrDefault: 4.0, AcceptanceRate: 0.8, IdleSeconds: 3600},
	}

	ranked := r.Rank(candidates)

	if ranked[0].DriverID != "long_idle" {
		t.Fatalf("expected the longer-idle driver to rank first when all else is equal, got %s", ranked[0].DriverID)
	}
}

func TestWeightedRanker_EmptyAndSingleCandidateDoNotPanic(t *testing.T) {
	r := NewDefaultWeightedRanker()

	if got := r.Rank(nil); len(got) != 0 {
		t.Fatalf("expected empty input to return empty output, got %v", got)
	}

	single := []types.Candidate{{DriverID: "only", DistanceMeters: 0, RatingOrDefault: 3.0, AcceptanceRate: 0.8}}
	ranked := r.Rank(single)
	if len(ranked) != 1 || ranked[0].DriverID != "only" {
		t.Fatalf("expected single-candidate input unchanged, got %v", ranked)
	}
}
