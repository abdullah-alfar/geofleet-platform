package httpapi

import (
	"context"

	"dispatch-service/internal/driverprofile"
)

type contextKey int

const (
	driverContextKey contextKey = iota
	correlationIDContextKey
)

func withDriver(ctx context.Context, profile *driverprofile.Profile) context.Context {
	return context.WithValue(ctx, driverContextKey, profile)
}

func driverFromContext(ctx context.Context) (*driverprofile.Profile, bool) {
	profile, ok := ctx.Value(driverContextKey).(*driverprofile.Profile)
	return profile, ok
}

func withCorrelationID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, correlationIDContextKey, id)
}

func correlationIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(correlationIDContextKey).(string)
	return id
}
