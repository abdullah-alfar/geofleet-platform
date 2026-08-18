import { defineStore } from 'pinia';

const STORAGE_KEY = 'driver-web:device';

interface DeviceState {
  deviceId: string | null;
  deviceToken: string | null;
}

/** The device credential (see AGENTS.md's "two separate driver
 * credentials" convention) is issued once by
 * POST /api/v1/driver/devices and is what dispatch-service,
 * location-service, and realtime-gateway's driver WebSocket all check —
 * never the Sanctum user token from stores/auth.ts. Stored separately so
 * logging out of the account doesn't silently invalidate a device
 * that's still physically registered server-side. */
export const useDeviceStore = defineStore('device', {
  state: (): DeviceState => ({
    deviceId: null,
    deviceToken: null,
  }),

  getters: {
    isRegistered: (state): boolean => state.deviceToken !== null,
  },

  actions: {
    restore() {
      if (!import.meta.client) return;
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      try {
        const parsed = JSON.parse(raw) as DeviceState;
        this.deviceId = parsed.deviceId;
        this.deviceToken = parsed.deviceToken;
      } catch {
        localStorage.removeItem(STORAGE_KEY);
      }
    },

    set(deviceId: string, deviceToken: string) {
      this.deviceId = deviceId;
      this.deviceToken = deviceToken;
      if (import.meta.client) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ deviceId, deviceToken }));
      }
    },

    clear() {
      this.deviceId = null;
      this.deviceToken = null;
      if (import.meta.client) {
        localStorage.removeItem(STORAGE_KEY);
      }
    },
  },
});
