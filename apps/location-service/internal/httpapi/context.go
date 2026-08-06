package httpapi

import (
	"context"

	"location-service/internal/gps"
)

// Unexported, typed context keys — never collide with keys set by other
// packages, and can't be constructed outside this package.
type contextKey int

const (
	deviceContextKey contextKey = iota
	correlationIDContextKey
)

func withDevice(ctx context.Context, device gps.Device) context.Context {
	return context.WithValue(ctx, deviceContextKey, device)
}

func deviceFromContext(ctx context.Context) (gps.Device, bool) {
	device, ok := ctx.Value(deviceContextKey).(gps.Device)
	return device, ok
}

func withCorrelationID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, correlationIDContextKey, id)
}

func correlationIDFromContext(ctx context.Context) string {
	id, _ := ctx.Value(correlationIDContextKey).(string)
	return id
}
