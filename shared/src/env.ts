import 'dotenv/config';

function require_env(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional_env(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

function optional_env_number(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const ENV = {
  SUPABASE_URL: require_env('SUPABASE_URL'),
  SUPABASE_SERVICE_ROLE_KEY: require_env('SUPABASE_SERVICE_ROLE_KEY'),
  SUPABASE_STORAGE_BUCKET_CCTV_IMAGES: optional_env('SUPABASE_STORAGE_BUCKET_CCTV_IMAGES', 'cctv-images'),
  MQTT_BROKER_URL: optional_env('MQTT_BROKER_URL', 'mqtt://localhost:1883'),
  MQTT_USERNAME: optional_env('MQTT_USERNAME'),
  MQTT_PASSWORD: optional_env('MQTT_PASSWORD'),
  MQTT_CLIENT_ID_PREFIX: optional_env('MQTT_CLIENT_ID_PREFIX', 'sijagaair'),
  DEFAULT_DEPLOYMENT_SLUG: optional_env('DEFAULT_DEPLOYMENT_SLUG', 'sijagaair-bojong-kulur'),
  FASTIFY_PORT: Number(optional_env('FASTIFY_PORT', '3100')),
  ALLOWED_ORIGIN: optional_env('ALLOWED_ORIGIN', 'http://localhost:5173'),
  /**
   * ID WhatsApp Channel (newsletter), mis: "120363426015806462@newsletter".
   * Jika kosong → auto-detect channel pertama dari akun yang login.
   */
  WHATSAPP_CHANNEL_ID: optional_env('WHATSAPP_CHANNEL_ID', ''),
  /** Nomor WhatsApp akun yang scan QR (hanya referensi log, bukan target pesan). */
  WHATSAPP_OWNER_NUMBER: optional_env('WHATSAPP_OWNER_NUMBER', ''),
  /** URL dashboard publik yang disisipkan ke pesan WhatsApp. */
  DASHBOARD_URL: optional_env('DASHBOARD_URL', ''),
  /** Port HTTP internal untuk notification-gateway (default 3101). */
  GATEWAY_HTTP_PORT: Number(optional_env('GATEWAY_HTTP_PORT', '3101')),
  /** Interval polling fallback mqtt_ingestion di data-processing (ms). */
  INGESTION_POLL_INTERVAL_MS: optional_env_number('INGESTION_POLL_INTERVAL_MS', 60_000),
  /** Debounce tryDispatch per correlation_id (ms). */
  DISPATCH_DEBOUNCE_MS: optional_env_number('DISPATCH_DEBOUNCE_MS', 3_000),
  /** Min jarak UPDATE last_seen_at per device di mqtt-collector (ms). */
  LAST_SEEN_THROTTLE_MS: optional_env_number('LAST_SEEN_THROTTLE_MS', 5 * 60_000),
};
