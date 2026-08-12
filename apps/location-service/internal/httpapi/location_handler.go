package httpapi

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"location-service/internal/gps"
	"location-service/internal/kafka"
	"location-service/internal/metrics"
	"location-service/internal/redisstore"
	"location-service/internal/validation"
)

// maxRequestBodyBytes bounds the ingestion payload — a GPS update JSON body
// is well under 1KB; this is the brief's "Request size limits" requirement
// applied to this endpoint specifically.
const maxRequestBodyBytes = 4 * 1024

type LocationHandler struct {
	validator *validation.Validator
	store     *redisstore.Store
	publisher kafka.Publisher
	metrics   *metrics.Metrics
	logger    *slog.Logger
}

func NewLocationHandler(
	validator *validation.Validator,
	store *redisstore.Store,
	publisher kafka.Publisher,
	m *metrics.Metrics,
	logger *slog.Logger,
) *LocationHandler {
	return &LocationHandler{
		validator: validator,
		store:     store,
		publisher: publisher,
		metrics:   m,
		logger:    logger,
	}
}

func (h *LocationHandler) Handle(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	h.metrics.UpdatesReceived.Inc()
	defer func() { h.metrics.IngestionDuration.Observe(time.Since(start).Seconds()) }()

	ctx := r.Context()
	correlationID := correlationIDFromContext(ctx)

	device, ok := deviceFromContext(ctx)
	if !ok {
		// deviceAuthMiddleware always sets this before this handler runs —
		// reaching here means the middleware chain was misconfigured, not a
		// client error.
		h.logger.Error("location handler reached without authenticated device", "correlation_id", correlationID)
		writeError(w, http.StatusInternalServerError, "internal_error", "unable to process request")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBodyBytes)

	var update gps.Update
	if err := json.NewDecoder(r.Body).Decode(&update); err != nil {
		writeError(w, http.StatusBadRequest, "malformed_request", "request body is not a valid GPS update")
		return
	}

	if update.DriverID == "" || update.DeviceID == "" {
		writeError(w, http.StatusBadRequest, "missing_required_field", "driver_id and device_id are required")
		return
	}

	// The authenticated device credential must match what the payload
	// claims — a valid token for one device must not be usable to submit
	// updates on behalf of a different driver or device (IDOR-style check
	// on the GPS ingestion path itself).
	if update.DriverID != device.DriverID || update.DeviceID != device.DeviceID {
		h.metrics.AuthFailures.Inc()
		writeError(w, http.StatusForbidden, "device_identity_mismatch", "payload driver_id/device_id does not match the authenticated device")
		return
	}

	allowed, err := h.store.CheckRateLimit(ctx, device.DriverID)
	if err != nil {
		h.logger.Error("rate limit check failed", "error", err, "correlation_id", correlationID)
		writeError(w, http.StatusServiceUnavailable, "storage_unavailable", "could not process request")
		return
	}
	if !allowed {
		h.metrics.ValidationRejections.WithLabelValues(string(gps.ReasonRateLimited)).Inc()
		writeError(w, http.StatusTooManyRequests, string(gps.ReasonRateLimited), "update frequency exceeds the allowed rate")
		return
	}

	// Best-effort raw stream (see internal/kafka package docs) — a failure
	// here is logged but never fails the request; driver.location.received.v1
	// is an audit/debug aid, not something other services depend on for
	// correctness.
	if err := h.publisher.PublishReceived(ctx, update, correlationID); err != nil {
		h.logger.Warn("failed to publish received event", "error", err, "correlation_id", correlationID)
	}

	lastState, err := h.store.GetLastState(ctx, device.DriverID)
	if err != nil {
		h.logger.Error("failed to load last state", "error", err, "correlation_id", correlationID)
		writeError(w, http.StatusServiceUnavailable, "storage_unavailable", "could not process request")
		return
	}

	if rejection := h.validator.Validate(device, update, lastState, time.Now()); rejection != nil {
		h.metrics.ValidationRejections.WithLabelValues(string(rejection.Reason)).Inc()
		h.logger.Info("gps update rejected",
			"reason", rejection.Reason,
			"driver_id", update.DriverID,
			"correlation_id", correlationID,
		)
		writeError(w, http.StatusUnprocessableEntity, string(rejection.Reason), rejection.Message)
		return
	}

	publishStart := time.Now()
	err = h.publisher.PublishValidated(ctx, update, device.RegionID, correlationID)
	h.metrics.KafkaPublishDuration.Observe(time.Since(publishStart).Seconds())
	if err != nil {
		h.metrics.KafkaPublishErrors.Inc()
		h.logger.Error("failed to publish validated event", "error", err, "correlation_id", correlationID)
		writeError(w, http.StatusServiceUnavailable, "publish_failed", "could not publish location update")
		return
	}

	// A failure here means Redis's "latest location" briefly lags behind
	// what was published to Kafka — recoverable by the next successful
	// update, and preferable to rejecting a request whose event was
	// already durably published (see internal/redisstore package docs for
	// the ordering rationale).
	if err := h.store.SaveLatest(ctx, device.DriverID, update); err != nil {
		h.logger.Error("failed to save latest location", "error", err, "correlation_id", correlationID)
	}

	h.metrics.UpdatesAccepted.Inc()
	writeJSON(w, http.StatusAccepted, map[string]any{
		"status":   "accepted",
		"sequence": update.Sequence,
	})
}
