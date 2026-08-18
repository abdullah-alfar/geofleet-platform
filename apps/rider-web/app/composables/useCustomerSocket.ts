import type { CustomerSocketMessage } from '~/types/ride';

const RECONNECT_DELAY_MS = 2000;

/**
 * Connects to realtime-gateway's customer WebSocket
 * (apps/realtime-gateway/internal/httpapi/ws.go::ServeCustomer) — the
 * actual push channel this whole feature exists for: `ride.assigned`,
 * `ride.unavailable`, and the assigned driver's live `driver.location`
 * all arrive here the instant they happen, not on some polling interval.
 * Browsers can't set custom headers on a WS upgrade request, so the
 * token goes as `?token=` (same bearer credential, just relocated — see
 * that file's own bearerToken() comment).
 */
export function useCustomerSocket(onMessage: (msg: CustomerSocketMessage) => void) {
  const config = useRuntimeConfig();
  const auth = useAuthStore();

  let socket: WebSocket | null = null;
  let wanted = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  function open() {
    if (!auth.token || !wanted) return;

    const url = `${config.public.realtimeGatewayWsUrl}/v1/ws/customer?token=${encodeURIComponent(auth.token)}`;
    socket = new WebSocket(url);

    socket.onmessage = (event) => {
      try {
        onMessage(JSON.parse(event.data) as CustomerSocketMessage);
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
