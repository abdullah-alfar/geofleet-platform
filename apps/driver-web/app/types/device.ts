/** core-api's DriverDeviceResource. */
export interface DriverDevice {
  id: string;
  device_identifier: string;
  platform: 'ios' | 'android';
  app_version: string | null;
  status: string;
  last_seen_at: string | null;
  created_at: string | null;
}
