import { formatWaktuWib } from './waMessageFormat.js';

/**
 * ok           = data level air masuk normal
 * sensor_fault = heartbeat masih masuk tapi data berhenti (firmware tidak mengirim saat sensor gagal baca)
 * offline      = data dan heartbeat sama-sama berhenti (listrik / WiFi / router)
 * unknown      = device belum pernah mengirim data (belum terpasang) — tidak dialarm
 */
export type SensorHealth = 'ok' | 'sensor_fault' | 'offline' | 'unknown';

/** Heartbeat firmware tiap 120 s, collector menulis last_seen_at paling cepat tiap 5 menit. */
const HEARTBEAT_STALE_MS = 15 * 60_000;
const MIN_STALE_MS = 10 * 60_000;

export function sensorHealth(opts: {
  lastReadingAt: string | null;
  lastSeenAt: string | null;
  readIntervalSec: number;
  now?: number;
}): SensorHealth {
  const now = opts.now ?? Date.now();
  if (!opts.lastReadingAt) return 'unknown';
  const staleMs = Math.max(3 * opts.readIntervalSec * 1000, MIN_STALE_MS);
  if (now - Date.parse(opts.lastReadingAt) <= staleMs) return 'ok';
  const seen = opts.lastSeenAt ? Date.parse(opts.lastSeenAt) : NaN;
  return Number.isFinite(seen) && now - seen <= HEARTBEAT_STALE_MS ? 'sensor_fault' : 'offline';
}

/** Gangguan yang sudah lebih tua dari ini saat pertama terlihat tidak diumumkan (mis. device mati lama). */
const STALE_OUTAGE_MS = 24 * 60 * 60_000;

/**
 * announce = kirim WA lalu catat · record = catat diam-diam · none = tidak ada perubahan.
 * Gangguan lama (>24 jam saat pertama terlihat, mis. setelah deploy/restart) dicatat tanpa WA
 * supaya Channel publik tidak dibanjiri kabar basi; pemulihannya tetap diumumkan.
 */
export function healthTransition(
  previous: SensorHealth,
  health: SensorHealth,
  lastReadingAt: string | null,
  now = Date.now()
): 'announce' | 'record' | 'none' {
  if (health === 'unknown' || health === previous || !lastReadingAt) return 'none';
  if (health !== 'ok' && previous === 'ok' && now - Date.parse(lastReadingAt) > STALE_OUTAGE_MS) {
    return 'record';
  }
  return 'announce';
}

/** Teks WA untuk perubahan kesehatan sensor (`ok` = pemberitahuan pulih). */
export function formatSensorHealthMessage(
  health: Exclude<SensorHealth, 'unknown'>,
  postName: string,
  lastReadingAt: string
): string {
  const sejak = `${formatWaktuWib(lastReadingAt)} WIB`;
  if (health === 'sensor_fault') {
    return `⚠️ *Sensor ${postName} gangguan*\nPerangkat masih online, tetapi data level air tidak masuk sejak ${sejak}.\nMohon petugas cek kabel/sensor di lokasi. Status air saat ini TIDAK terpantau.`;
  }
  if (health === 'offline') {
    return `⚠️ *Perangkat ${postName} offline*\nTidak ada data maupun sinyal perangkat sejak ${sejak}.\nMohon petugas cek listrik, WiFi, dan router di lokasi. Status air saat ini TIDAK terpantau.`;
  }
  return `✅ *Sensor ${postName} kembali normal*\nData level air sudah masuk lagi.`;
}
