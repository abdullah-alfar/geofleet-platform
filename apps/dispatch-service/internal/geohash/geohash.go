// Package geohash wraps github.com/mmcloughlin/geohash as dispatch-
// service's hierarchical geographic-cell strategy — the brief's "H3 or an
// equivalent" requirement. See docs/decisions/0005-geohash-and-dispatch-db-access.md
// for why geohash was chosen over H3 (avoids a cgo dependency) and the
// resulting trade-off (rectangular, not hexagonal, cells — slightly uneven
// neighbor distances near cell corners, acceptable at this precision for
// candidate pre-filtering that's always followed by an accurate haversine
// distance calculation).
package geohash

import "github.com/mmcloughlin/geohash"

// Cell returns the geohash for a coordinate at the given precision
// (character count). Precision 6 ≈ 1.2km x 0.61km cells — see
// internal/config's GeohashPrecision doc comment.
func Cell(lat, lng float64, precision uint) string {
	return geohash.EncodeWithPrecision(lat, lng, precision)
}

// CellsToSearch returns the cell containing (lat, lng) plus its 8
// neighbors — the geohash equivalent of an H3 k=1 grid disk. Candidate
// drivers are read from all 9 cells before ranking.
func CellsToSearch(lat, lng float64, precision uint) []string {
	center := Cell(lat, lng, precision)
	neighbors := geohash.Neighbors(center)

	cells := make([]string, 0, len(neighbors)+1)
	cells = append(cells, center)
	cells = append(cells, neighbors...)
	return cells
}
