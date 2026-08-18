/** dispatch-service's ListPending/offer shape
 * (apps/dispatch-service/internal/httpapi/offer_handlers.go). */
export interface RideOffer {
  offer_id: string;
  ride_request_id: string;
  offered_at: string;
  expires_at: string;
}

/** realtime-gateway's driver WebSocket message envelope — the only
 * message type a driver connection ever receives besides the initial
 * `connected` ack (apps/realtime-gateway/internal/relay/handlers.go's
 * NewOfferCreatedHandler). */
export type DriverSocketMessage =
  | { type: 'connected'; data: { driver_id: string } }
  | {
      type: 'ride.offer.created';
      data: { ride_request_id: string; offer_id: string; expires_at: string };
    };
