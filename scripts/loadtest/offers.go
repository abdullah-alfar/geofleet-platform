package main

import (
	"sync"
	"sync/atomic"
	"time"
)

// offerPollAttempts/offerPollInterval match scripts/api-test/10-check-offers.sh's
// own polling convention exactly (10 attempts, 1.5s apart — a 15s ceiling,
// the same as dispatch-service's own OFFER_TTL, see .env.example) so an
// offer that's genuinely there is never missed by polling too slowly.
const (
	offerPollAttempts = 10
	offerPollInterval = 1500 * time.Millisecond
)

type offerListResponse struct {
	Data []struct {
		OfferID string `json:"offer_id"`
	} `json:"data"`
}

type acceptRunResult struct {
	accepted int64
	noOffer  int64
	failed   int64
}

// acceptPendingOffers has every driver poll dispatch-service for its own
// pending offer (mirrors scripts/api-test/10-check-offers.sh +
// 11-accept-offer.sh, run concurrently across the whole fleet instead of
// one driver at a time) and accept it. This is what turns a matched ride
// request into an assigned ride and flips the driver to unavailable in
// dispatch-service's own Redis index (internal/offers/service.go's
// SetAvailability(false) on accept) — real state changes for the admin
// dashboard's live map/counters to show, not just idle pins. A driver
// whose ride request never matched anyone (see runRideRequestBurst's own
// doc comment on this being a probabilistic scenario) legitimately gets
// no offer; that's not a failure.
func acceptPendingOffers(cfg config, drivers []driver) acceptRunResult {
	var result acceptRunResult
	var wg sync.WaitGroup
	sem := make(chan struct{}, cfg.rideBurstConcurrency)

	for _, d := range drivers {
		wg.Add(1)
		sem <- struct{}{}
		go func(d driver) {
			defer wg.Done()
			defer func() { <-sem }()

			offerID, err := pollForOffer(cfg, d)
			if err != nil {
				atomic.AddInt64(&result.failed, 1)
				return
			}
			if offerID == "" {
				atomic.AddInt64(&result.noOffer, 1)
				return
			}

			if err := postJSON(cfg.dispatchService+"/v1/ride-offers/"+offerID+"/accept", d.deviceToken, nil, nil); err != nil {
				atomic.AddInt64(&result.failed, 1)
				return
			}
			atomic.AddInt64(&result.accepted, 1)
		}(d)
	}
	wg.Wait()
	return result
}

func pollForOffer(cfg config, d driver) (string, error) {
	for i := 0; i < offerPollAttempts; i++ {
		var resp offerListResponse
		if err := getJSON(cfg.dispatchService+"/v1/ride-offers/pending", d.deviceToken, &resp); err != nil {
			return "", err
		}
		if len(resp.Data) > 0 && resp.Data[0].OfferID != "" {
			return resp.Data[0].OfferID, nil
		}
		time.Sleep(offerPollInterval)
	}
	return "", nil
}
