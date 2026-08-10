// Package auth authenticates WebSocket upgrades against Postgres, reusing
// the two credential schemes already used elsewhere in this platform
// rather than inventing a third:
//
//   - Drivers: the device-token scheme from apps/location-service and
//     apps/dispatch-service (SHA-256 hash of a bearer token, looked up in
//     driver_devices).
//   - Customers: the same Sanctum personal-access-token scheme core-api's
//     HTTP API uses (Authorization: Bearer {id}|{plaintext}).
//
// See docs/decisions/0006-realtime-gateway-fanout.md and the
// realtime_gateway Postgres role's grants (narrowly read-only — this
// package never writes anything).
package auth

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalidCredentials = errors.New("auth: invalid credentials")

type Driver struct {
	DriverUUID string
}

type Customer struct {
	CustomerUUID string
}

type Store struct {
	pool *pgxpool.Pool
}

func New(pool *pgxpool.Pool) *Store {
	return &Store{pool: pool}
}

func Connect(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, fmt.Errorf("auth: connect: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("auth: ping: %w", err)
	}
	return pool, nil
}

// AuthenticateDriver hashes the raw device token (same SHA-256 scheme
// apps/location-service and apps/dispatch-service use) and looks it up.
// Identical query to apps/dispatch-service's LookupDeviceByTokenHash.
func (s *Store) AuthenticateDriver(ctx context.Context, rawToken string) (*Driver, error) {
	tokenHash := sha256Hex(rawToken)

	const query = `
		SELECT d.uuid::text
		FROM driver_devices dd
		JOIN drivers d ON d.id = dd.driver_id
		WHERE dd.token_hash = $1 AND dd.status = 'active' AND d.status = 'active'
	`

	var driverUUID string
	err := s.pool.QueryRow(ctx, query, tokenHash).Scan(&driverUUID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, fmt.Errorf("auth: lookup driver device: %w", err)
	}
	return &Driver{DriverUUID: driverUUID}, nil
}

// AuthenticateCustomer mirrors Sanctum's own
// PersonalAccessToken::findToken(): a bearer token of the form
// "{id}|{plaintext}" is split, the plaintext half is SHA-256 hashed (same
// algorithm Sanctum's HasApiTokens::createToken uses), and matched against
// the stored hash for that specific token id — not a hash-only lookup,
// so a leaked hash collision can't be used to authenticate as an arbitrary
// token row.
func (s *Store) AuthenticateCustomer(ctx context.Context, bearerToken string) (*Customer, error) {
	tokenID, plaintext, ok := splitSanctumToken(bearerToken)
	if !ok {
		return nil, ErrInvalidCredentials
	}
	tokenHash := sha256Hex(plaintext)

	const query = `
		SELECT c.uuid::text
		FROM personal_access_tokens pat
		JOIN users u ON u.id = pat.tokenable_id AND pat.tokenable_type = 'App\Models\User'
		JOIN customers c ON c.user_id = u.id
		WHERE pat.id = $1 AND pat.token = $2
		  AND (pat.expires_at IS NULL OR pat.expires_at > NOW())
		  AND u.status = 'active'
	`

	var customerUUID string
	err := s.pool.QueryRow(ctx, query, tokenID, tokenHash).Scan(&customerUUID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidCredentials
	}
	if err != nil {
		return nil, fmt.Errorf("auth: lookup customer token: %w", err)
	}
	return &Customer{CustomerUUID: customerUUID}, nil
}

// splitSanctumToken splits a "{id}|{plaintext}" bearer token, same split
// Sanctum's own PersonalAccessToken::findToken() performs.
func splitSanctumToken(bearerToken string) (id int64, plaintext string, ok bool) {
	idPart, rest, found := strings.Cut(bearerToken, "|")
	if !found || rest == "" {
		return 0, "", false
	}
	id, err := strconv.ParseInt(idPart, 10, 64)
	if err != nil {
		return 0, "", false
	}
	return id, rest, true
}

func sha256Hex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}
