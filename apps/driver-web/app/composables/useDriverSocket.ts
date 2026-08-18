import type { DriverSocketMessage } from '~/types/offer';

const RECONNECT_DELAY_MS = 2000;

/**
 * Connects to realtime-gateway's driver WebSocket
 * (apps/realtime-gateway/internal/httpapi/ws.go::ServeDriver) — pushes
 * `ride.offer.created` the instant dispatch-service creates one, instead
 * of leaving this app to poll GET /v1/ride-offers/pending on a timer.
 * Authenticated with the device token, same as every other
 * dispatch-service/location-service call — not the Sanctum user token.
 */
export function useDriverSocket(onMessage: (msg: DriverSocketMessage) => void) {
  const config = useRuntimeConfig();
  const device = useDeviceStore();

  let socket: WebSocket | null = null;
  let wanted = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function open() {
    if (!device.deviceToken || !wanted) return;

    const url = `${config.public.realtimeGatewayWsUrl}/v1/ws/driver?token=${encodeURIComponent(device.deviceToken)}`;
    socket = new WebSocket(url);

    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data) as DriverSocketMessage);
      } catch {
        // Malformed frame — ignore rather than crash the connection.
      }
    };

    socket.onclose = () => {
      socket = null;
      if (wanted) {
        reconnectTimer = setTimeout(open, RECONNECT_DELAY_MS);
      }
    };
  }

  function connect() {
    wanted = true;
    open();
  }

  function disconnect() {
    wanted = false;
    clearTimeout(reconnectTimer);
    socket?.close();
    socket = null;
  }

  return { connect, disconnect };
}
