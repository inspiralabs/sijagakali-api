import type { WaterStatus } from '@sijagaair/shared';

interface PolicyConfig {
  notify_digest_hours_local: number[];
  notify_surge_delta_cm: number;
  notify_surge_window_min: number;
  notify_cooldown_waspada_sec: number;
  notify_cooldown_siaga_sec: number;
  notify_cooldown_bahaya_sec: number;
}

interface DeviceNotifState {
  lastStatus: WaterStatus;
  lastNotifAt: number; // unix ms
  recentLevels: Array<{ level: number; ts: number }>;
}

/** Cache state per device (deployment_slug:device_id) */
const state = new Map<string, DeviceNotifState>();

function getState(key: string, currentStatus: WaterStatus): DeviceNotifState {
  if (!state.has(key)) {
    state.set(key, { lastStatus: currentStatus, lastNotifAt: 0, recentLevels: [] });
  }
  return state.get(key)!;
}

/**
 * Tentukan apakah notifikasi WhatsApp boleh dikirim.
 * Mengembalikan true jika salah satu kondisi terpenuhi:
 *   1. Status level berubah (naik atau turun)
 *   2. Lonjakan cepat >= surge_delta dalam surge_window_min menit
 *   3. Dalam slot jam digest (dan status normal/aman)
 *   4. Cooldown untuk status yang sama sudah habis
 */
export function shouldNotify(
  deploymentSlug: string,
  deviceId: string,
  waterLevel: number,
  waterStatus: WaterStatus,
  config: PolicyConfig
): boolean {
  const key = `${deploymentSlug}:${deviceId}`;
  const s = getState(key, waterStatus);
  const now = Date.now();

  // Tambah ke riwayat level
  s.recentLevels.push({ level: waterLevel, ts: now });
  const windowMs = config.notify_surge_window_min * 60_000;
  s.recentLevels = s.recentLevels.filter((r) => now - r.ts <= windowMs);

  let should = false;

  // 1. Perubahan status (naik atau turun)
  if (waterStatus !== s.lastStatus) {
    should = true;
  }

  // 2. Lonjakan cepat
  if (!should && s.recentLevels.length >= 2) {
    const oldest = s.recentLevels[0]!.level;
    const delta = waterLevel - oldest;
    if (delta >= config.notify_surge_delta_cm) should = true;
  }

  // 3. Slot jam digest (normal/aman)
  if (!should && waterStatus === 'normal') {
    const hourWib = new Date().toLocaleString('en-US', {
      timeZone: 'Asia/Jakarta',
      hour: 'numeric',
      hour12: false,
    });
    const h = parseInt(hourWib, 10);
    if (config.notify_digest_hours_local.includes(h)) {
      should = true;
    }
  }

  // 4. Cooldown untuk status yang sama
  if (!should && waterStatus === s.lastStatus) {
    const cooldownSec =
      waterStatus === 'bahaya'
        ? config.notify_cooldown_bahaya_sec
        : waterStatus === 'siaga'
          ? config.notify_cooldown_siaga_sec
          : config.notify_cooldown_waspada_sec;
    if ((now - s.lastNotifAt) / 1000 >= cooldownSec) {
      should = true;
    }
  }

  if (should) {
    s.lastStatus = waterStatus;
    s.lastNotifAt = now;
  }

  return should;
}
