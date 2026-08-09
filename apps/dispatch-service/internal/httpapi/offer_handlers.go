package httpapi

import (
	"errors"
	"log/slog"
	"net/http"

	"dispatch-service/internal/offers"
	"dispatch-service/internal/offerstore"
)

type OfferHandler struct {
	service *offers.Service
	store   *offerstore.Store
	logger  *slog.Logger
}

func NewOfferHandler(service *offers.Service, store *offerstore.Store, logger *slog.Logger) *OfferHandler {
	return &OfferHandler{service: service, store: store, logger: logger}
}

func (h *OfferHandler) Accept(w http.ResponseWriter, r *http.Request) {
	driver, ok := driverFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusInternalServerError, "internal_error", "unable to process request")
		return
	}
	offerUUID := r.PathValue("id")
	correlationID := correlationIDFromContext(r.Context())

	result, err := h.service.Accept(r.Context(), offerUUID, driver.UUID, driver.ID, correlationID)
	if errors.Is(err, offers.ErrOfferNotAvailable) {
		writeError(w, http.StatusConflict, "offer_not_available", "this offer is no longer pending (expired, already resolved, or the ride was cancelled)")
		return
	}
	if err != nil {
		h.logger.Error("accept offer failed", "error", err, "correlation_id", correlationID)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not process acceptance")
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"status":          "accepted",
		"ride_request_id": result.RideRequestUUID,
	})
}

func (h *OfferHandler) Reject(w http.ResponseWriter, r *http.Request) {
	driver, ok := driverFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusInternalServerError, "internal_error", "unable to process request")
		return
	}
	offerUUID := r.PathValue("id")
	correlationID := correlationIDFromContext(r.Context())

	err := h.service.Reject(r.Context(), offerUUID, driver.UUID, driver.ID, correlationID)
	if errors.Is(err, offers.ErrOfferNotAvailable) {
		writeError(w, http.StatusConflict, "offer_not_available", "this offer is no longer pending")
		return
	}
	if err != nil {
		h.logger.Error("reject offer failed", "error", err, "correlation_id", correlationID)
		writeError(w, http.StatusInternalServerError, "internal_error", "could not process rejection")
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"status": "rejected"})
}

// ListPending lets a driver poll for an offer to respond to —
// realtime-gateway (Phase 6) doesn't exist yet to push one.
func (h *OfferHandler) ListPending(w http.ResponseWriter, r *http.Request) {
	driver, ok := driverFromContext(r.Context())
	if !ok {
		writeError(w, http.StatusInternalServerError, "internal_error", "unable to process request")
		return
	}

	pending, err := h.store.ListPendingOffersForDriver(r.Context(), driver.ID)
	if err != nil {
		h.logger.Error("list pending offers failed", "error", err, "correlation_id", correlationIDFromContext(r.Context()))
		writeError(w, http.StatusInternalServerError, "internal_error", "could not load pending offers")
		return
	}

	data := make([]map[string]any, 0, len(pending))
	for _, o := range pending {
		data = append(data, map[string]any{
			"offer_id":        o.OfferUUID,
			"ride_request_id": o.RideRequestUUID,
			"offered_at":      o.OfferedAt,
			"expires_at":      o.ExpiresAt,
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{"data": data})
}
