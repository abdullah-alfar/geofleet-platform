/**
 * Sends one GPS fix to location-service. `sequence` uses the current
 * epoch-ms timestamp — trivially strictly increasing across calls
 * (location-service rejects any non-increasing sequence or `recorded_at`
 * per device, see internal/validation/validation.go) — and
 * `recorded_at` is generated fresh at send time for the same reason.
 */
export function useGpsPing() {
  const device = useDeviceStore();
  const { call } = useDeviceApi();
  const config = useRuntimeConfig();

  function sendPing(driverId: string, lat: number, lng: number, accuracyMeters = 10) {
    return call(config.public.locationServiceBaseUrl, 'POST', '/v1/locations', {
      driver_id: driverId,
      device_id: device.deviceId,
      latitude: lat,
      longitude: lng,
      accuracy_meters: accuracyMeters,
      sequence: Date.now(),
      recorded_at: new Date().toISOString(),
    });
  }

  return { sendPing };
}
