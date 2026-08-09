// Package offerstore is dispatch-service's write boundary against Postgres
// — everything that touches ride_offers (which this service owns outright)
// or the narrow, column-scoped slice of ride_requests it's allowed to write
// (status, driver_id, accepted_at — see
// apps/core-api/database/migrations/2026_08_09_100000_create_dispatch_service_role.php).
//
// The concurrency-critical operations (AcceptOffer, ExpireStaleOffers) use
// the brief's mandated pattern: a conditional UPDATE guarded by current
// status, never a read-then-write. See docs/decisions and AGENTS.md.
package offerstore

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrNotFound      = errors.New("not found")
	ErrAlreadyClosed = errors.New("offer or ride request already in a terminal/other state")
)

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

// ExistingOfferDriverUUIDs returns every driver already offered this ride
// (any status) so a re-trigger (expiry, rejection) never offers the same
// driver twice for the same ride request.
func (s *Store) ExistingOfferDriverUUIDs(ctx context.Context, rideRequestID int64) ([]string, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT d.uuid::text
		FROM ride_offers ro
		JOIN drivers d ON d.id = ro.driver_id
		WHERE ro.ride_request_id = $1
	`, rideRequestID)
	if err != nil {
		return nil, fmt.Errorf("offerstore: existing offer drivers: %w", err)
	}
	defer rows.Close()

	var uuids []string
	for rows.Next() {
		var u string
		if err := rows.Scan(&u); err != nil {
			return nil, fmt.Errorf("offerstore: scan: %w", err)
		}
		uuids = append(uuids, u)
	}
	return uuids, rows.Err()
}

type PendingOffer struct {
	OfferUUID       string
	RideRequestUUID string
	OfferedAt       time.Time
	ExpiresAt       time.Time
}

// ListPendingOffersForDriver lets a driver discover an offer to respond to
// without a push channel — realtime-gateway (Phase 6) doesn't exist yet, so
// this is the only way a driver's app can currently learn about one.
func (s *Store) ListPendingOffersForDriver(ctx context.Context, driverID int64) ([]PendingOffer, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT ro.uuid::text, r.uuid::text, ro.offered_at, ro.expires_at
		FROM ride_offers ro
		JOIN ride_requests r ON r.id = ro.ride_request_id
		WHERE ro.driver_id = $1 AND ro.status = 'pending' AND ro.expires_at > NOW()
		ORDER BY ro.offered_at DESC
	`, driverID)
	if err != nil {
		return nil, fmt.Errorf("offerstore: list pending offers: %w", err)
	}
	defer rows.Close()

	var offers []PendingOffer
	for rows.Next() {
		var o PendingOffer
		if err := rows.Scan(&o.OfferUUID, &o.RideRequestUUID, &o.OfferedAt, &o.ExpiresAt); err != nil {
			return nil, fmt.Errorf("offerstore: scan pending offer: %w", err)
		}
		offers = append(offers, o)
	}
	return offers, rows.Err()
}

func (s *Store) CountOffers(ctx context.Context, rideRequestID int64) (int, error) {
	var count int
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM ride_offers WHERE ride_request_id = $1`, rideRequestID).Scan(&count)
	if err != nil {
		return 0, fmt.Errorf("offerstore: count offers: %w", err)
	}
	return count, nil
}

type CreatedOffer struct {
	ID        int64
	UUID      string
	ExpiresAt time.Time
}

// CreateOfferAndMarkOffered inserts the offer and (only on the first offer
// for this ride request) flips ride_requests.status from 'searching' to
// 'offered', in one transaction — a re-trigger where status is already
// 'offered' just no-ops that second statement, which is fine, not an error.
func (s *Store) CreateOfferAndMarkOffered(ctx context.Context, rideRequestID, driverID int64, ttl time.Duration) (*CreatedOffer, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("offerstore: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	offeredAt := time.Now()
	expiresAt := offeredAt.Add(ttl)

	var offer CreatedOffer
	err = tx.QueryRow(ctx, `
		INSERT INTO ride_offers (ride_request_id, driver_id, status, offered_at, expires_at)
		VALUES ($1, $2, 'pending', $3, $4)
		RETURNING id, uuid::text, expires_at
	`, rideRequestID, driverID, offeredAt, expiresAt).Scan(&offer.ID, &offer.UUID, &offer.ExpiresAt)
	if err != nil {
		return nil, fmt.Errorf("offerstore: insert offer: %w", err)
	}

	_, err = tx.Exec(ctx, `
		UPDATE ride_requests SET status = 'offered' WHERE id = $1 AND status = 'searching'
	`, rideRequestID)
	if err != nil {
		return nil, fmt.Errorf("offerstore: mark offered: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("offerstore: commit: %w", err)
	}
	return &offer, nil
}

// MarkUnavailable is the terminal "no candidates left" transition. Returns
// false (not an error) if the ride request was already resolved by
// something else concurrently (e.g. customer cancellation) — that's a
// normal race, not a failure.
func (s *Store) MarkUnavailable(ctx context.Context, rideRequestID int64) (bool, error) {
	tag, err := s.pool.Exec(ctx, `
		UPDATE ride_requests SET status = 'unavailable'
		WHERE id = $1 AND status IN ('searching', 'offered')
	`, rideRequestID)
	if err != nil {
		return false, fmt.Errorf("offerstore: mark unavailable: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

type AcceptedRide struct {
	RideRequestID   int64
	RideRequestUUID string
	RegionID        string
	CustomerUUID    string
}

// AcceptOffer is the double-atomic-update at the heart of this service's
// concurrency guarantee: claim the OFFER, then claim the RIDE, both
// conditional on their current status, both in one transaction. If either
// conditional UPDATE affects zero rows, the whole transaction rolls back —
// an offer can never end up "accepted" while the ride it was for went to
// someone else, and a ride can never end up assigned to two drivers, no
// matter how these requests interleave.
func (s *Store) AcceptOffer(ctx context.Context, offerUUID string, driverID int64) (*AcceptedRide, error) {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("offerstore: begin: %w", err)
	}
	defer tx.Rollback(ctx)

	var rideRequestID int64
	err = tx.QueryRow(ctx, `
		UPDATE ride_offers
		SET status = 'accepted', responded_at = NOW()
		WHERE uuid = $1 AND driver_id = $2 AND status = 'pending'
		RETURNING ride_request_id
	`, offerUUID, driverID).Scan(&rideRequestID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAlreadyClosed
	}
	if err != nil {
		return nil, fmt.Errorf("offerstore: claim offer: %w", err)
	}

	var result AcceptedRide
	err = tx.QueryRow(ctx, `
		UPDATE ride_requests
		SET driver_id = $2, status = 'accepted', accepted_at = NOW()
		WHERE id = $1 AND status IN ('searching', 'offered')
		RETURNING id, uuid::text, region_id, (SELECT uuid::text FROM customers WHERE id = ride_requests.customer_id)
	`, rideRequestID, driverID).Scan(&result.RideRequestID, &result.RideRequestUUID, &result.RegionID, &result.CustomerUUID)
	if errors.Is(err, pgx.ErrNoRows) {
		// The offer claim succeeded but the ride itself was already
		// resolved by something else in the same instant (e.g. customer
		// cancellation racing the accept) — roll back the offer claim too
		// via the deferred Rollback, so no state is left inconsistent.
		return nil, ErrAlreadyClosed
	}
	if err != nil {
		return nil, fmt.Errorf("offerstore: claim ride: %w", err)
	}

	// Every other still-pending offer for this ride is now moot — mark
	// them 'superseded' (not 'rejected': the driver didn't decline it,
	// someone else just got there first) so they stop showing as
	// actionable to those drivers.
	_, err = tx.Exec(ctx, `
		UPDATE ride_offers SET status = 'superseded', responded_at = NOW()
		WHERE ride_request_id = $1 AND status = 'pending'
	`, rideRequestID)
	if err != nil {
		return nil, fmt.Errorf("offerstore: supersede other offers: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("offerstore: commit: %w", err)
	}
	return &result, nil
}

type RejectedOffer struct {
	RideRequestID   int64
	RideRequestUUID string
	RegionID        string
}

// RejectOffer records an explicit decline. Returns the ride request so the
// caller can re-trigger matching for the next candidate.
func (s *Store) RejectOffer(ctx context.Context, offerUUID string, driverID int64) (*RejectedOffer, error) {
	var r RejectedOffer
	err := s.pool.QueryRow(ctx, `
		UPDATE ride_offers
		SET status = 'rejected', responded_at = NOW()
		WHERE uuid = $1 AND driver_id = $2 AND status = 'pending'
		RETURNING
			ride_request_id,
			(SELECT uuid::text FROM ride_requests WHERE id = ride_offers.ride_request_id),
			(SELECT region_id FROM ride_requests WHERE id = ride_offers.ride_request_id)
	`, offerUUID, driverID).Scan(&r.RideRequestID, &r.RideRequestUUID, &r.RegionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAlreadyClosed
	}
	if err != nil {
		return nil, fmt.Errorf("offerstore: reject offer: %w", err)
	}
	return &r, nil
}

type ExpiredOffer struct {
	RideRequestID   int64
	RideRequestUUID string
}

// ExpireStaleOffers atomically expires every pending offer past its
// expires_at, returning the distinct ride requests affected so the caller
// can re-trigger matching for each. The status='pending' guard means an
// offer accepted/rejected in the same instant this sweep runs is simply
// excluded — not double-transitioned.
func (s *Store) ExpireStaleOffers(ctx context.Context) ([]ExpiredOffer, error) {
	rows, err := s.pool.Query(ctx, `
		UPDATE ride_offers
		SET status = 'expired', responded_at = NOW()
		WHERE status = 'pending' AND expires_at < NOW()
		RETURNING ride_request_id, (SELECT uuid::text FROM ride_requests WHERE id = ride_offers.ride_request_id)
	`)
	if err != nil {
		return nil, fmt.Errorf("offerstore: expire stale offers: %w", err)
	}
	defer rows.Close()

	var expired []ExpiredOffer
	for rows.Next() {
		var e ExpiredOffer
		if err := rows.Scan(&e.RideRequestID, &e.RideRequestUUID); err != nil {
			return nil, fmt.Errorf("offerstore: scan expired: %w", err)
		}
		expired = append(expired, e)
	}
	return expired, rows.Err()
}
