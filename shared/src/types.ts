/** Payload MQTT topik `sijagaair/{device_id}/sensor/data` */
export interface SensorDataPayload {
  deployment_slug?: string;
  device_id: string;
  correlation_id: string;
  water_level_cm: number;
  timestamp: string;
  rssi?: number;
  battery_pct?: number;
}

/** Payload MQTT topik `sijagaair/{device_id}/cctv/meta` (opsional) */
export interface CctvMetaPayload {
  deployment_slug?: string;
  device_id: string;
  correlation_id: string;
  timestamp: string;
  image_bytes_length?: number;
}

/** Payload MQTT topik `sijagaair/{device_id}/sensor/status` (heartbeat) */
export interface SensorStatusPayload {
  deployment_slug?: string;
  device_id: string;
  timestamp: string;
  online: boolean;
  uptime_sec?: number;
  firmware_version?: string;
  last_error?: string | null;
  heap_free_bytes?: number;
}

/** Konstanta topik MQTT */
export const TOPICS = {
  SENSOR_DATA: 'sijagaair/+/sensor/data',
  SENSOR_STATUS: 'sijagaair/+/sensor/status',
  CCTV_IMAGE: 'sijagaair/+/cctv/image',
  CCTV_META: 'sijagaair/+/cctv/meta',
  CONFIG_INTERVAL: (deviceId: string) => `sijagaair/${deviceId}/config/interval`,
  COMMAND: (deviceId: string) => `sijagaair/${deviceId}/command`,
} as const;

/** Ekstrak device_id dari topik MQTT (mis. "sijagaair/node-001/sensor/data" → "node-001") */
export function extractDeviceId(topic: string): string | null {
  const parts = topic.split('/');
  return parts.length >= 2 ? (parts[1] ?? null) : null;
}

/** Event yang dikirim data-processing ke notification-gateway */
export interface NotificationEvent {
  reading_id: string;
  deployment_slug: string;
  device_id: string;
  location_name: string;
  water_level_cm: number;
  water_status: 'normal' | 'waspada' | 'siaga' | 'bahaya';
  cctv_image_path: string | null;
  recorded_at: string;
  /** `deployments.display_name` untuk placeholder {wilayah} */
  deployment_display_name: string;
  read_interval_sec: number;
  threshold_waspada_cm: number;
  threshold_siaga_cm: number;
  threshold_bahaya_cm: number;
  /** cm di atas ambang waspada (≥0), untuk {selisih} */
  selisih_cm: number;
  contact_petugas: string | null;
  contact_bpbd: string | null;
  contact_posko: string | null;
}

export type WaterStatus = 'normal' | 'waspada' | 'siaga' | 'bahaya';

export interface DeviceThresholds {
  threshold_waspada_cm: number;
  threshold_siaga_cm: number;
  threshold_bahaya_cm: number;
}

export function calcWaterStatus(level: number, t: DeviceThresholds): WaterStatus {
  if (level >= t.threshold_bahaya_cm) return 'bahaya';
  if (level >= t.threshold_siaga_cm) return 'siaga';
  if (level >= t.threshold_waspada_cm) return 'waspada';
  return 'normal';
}
