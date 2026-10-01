import 'dotenv/config';
import {
  getSupabase,
  ENV,
  calcWaterStatus,
  computeSelisihCmAboveWaspada,
  notifyGateway,
  captureSnapshot,
  isSnapshotDue,
  notifyGatewayText,
  sensorHealth,
  healthTransition,
  formatSensorHealthMessage,
  type NotificationEvent,
  type SensorHealth,
} from '@sijagakali/shared';
import { shouldNotify } from './notificationPolicy.js';

const supabase = getSupabase();
const defaultDeployment = ENV.DEFAULT_DEPLOYMENT_SLUG;

const POLL_INTERVAL_MS = ENV.INGESTION_POLL_INTERVAL_MS;
const DISPATCH_DEBOUNCE_MS = ENV.DISPATCH_DEBOUNCE_MS;

type MqttIngestionRow = {
  id: string;
  deployment_slug: string;
  device_id: string;
  correlation_id: string;
  message_type: 'sensor_data' | 'cctv_image';
  payload_json: Record<string, unknown> | null;
  cctv_storage_path: string | null;
  ingest_status: string;
};

type DeviceConfigRow = {
  deployment_slug: string;
  device_id: string;
  location_name: string;
  display_name: string | null;
  read_interval_sec: number;
  threshold_waspada_cm: number;
  threshold_siaga_cm: number;
  threshold_bahaya_cm: number;
  notify_digest_hours_local: number[];
  notify_surge_delta_cm: number;
  notify_surge_window_min: number;
  notify_cooldown_waspada_sec: number;
  notify_cooldown_siaga_sec: number;
  notify_cooldown_bahaya_sec: number;
  cctv_local_ip: string | null;
};

/** Cache konfigurasi device, refresh setiap 5 menit */
const configCache = new Map<string, DeviceConfigRow>();
setInterval(() => configCache.clear(), 5 * 60_000);

type DeploymentNotifyRow = {
  display_name: string;
  contact_petugas: string | null;
  contact_bpbd: string | null;
  contact_posko: string | null;
};

const deploymentCache = new Map<string, DeploymentNotifyRow>();
setInterval(() => deploymentCache.clear(), 5 * 60_000);

const metrics = {
  poll_ran_realtime_healthy: 0,
  poll_ran_realtime_unhealthy: 0,
  dispatch_scheduled: 0,
  dispatch_ok: 0,
};

let realtimeHealthy = false;

const dispatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
const dispatchInFlight = new Set<string>();

// Realtime notifies almost instantly (WAL-based), but the row can take a
// moment longer to become visible to a plain SELECT through the pooled
// PostgREST connection. If tryDispatch finds nothing yet, retry a few times
// instead of silently dropping the reading — see 2026-09-03 investigation.
const MAX_DISPATCH_RETRIES = 5;
const DISPATCH_RETRY_DELAY_MS = 1500;
const dispatchRetryCounts = new Map<string, number>();

async function getDeviceConfig(
  deploymentSlug: string,
  deviceId: string
): Promise<DeviceConfigRow | null> {
  const key = `${deploymentSlug}:${deviceId}`;
  if (configCache.has(key)) return configCache.get(key)!;

  const { data, error } = await supabase
    .from('device_configs')
    .select(
      'deployment_slug,device_id,location_name,display_name,read_interval_sec,threshold_waspada_cm,threshold_siaga_cm,threshold_bahaya_cm,notify_digest_hours_local,notify_surge_delta_cm,notify_surge_window_min,notify_cooldown_waspada_sec,notify_cooldown_siaga_sec,notify_cooldown_bahaya_sec,cctv_local_ip'
    )
    .eq('deployment_slug', deploymentSlug)
    .eq('device_id', deviceId)
    .single();

  if (error || !data) {
    console.error('[processing] getDeviceConfig error:', error?.message);
    return null;
  }

  configCache.set(key, data as DeviceConfigRow);
  return data as DeviceConfigRow;
}

async function getDeploymentNotifyRow(deploymentSlug: string): Promise<DeploymentNotifyRow | null> {
  if (deploymentCache.has(deploymentSlug)) return deploymentCache.get(deploymentSlug)!;

  const { data, error } = await supabase
    .from('deployments')
    .select('display_name,contact_petugas,contact_bpbd,contact_posko')
    .eq('slug', deploymentSlug)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('[processing] getDeploymentNotifyRow error:', error.message);
    return null;
  }

  const row = data as DeploymentNotifyRow;
  deploymentCache.set(deploymentSlug, row);
  return row;
}

/** @returns true jika sensor_readings berhasil di-insert */
async function tryDispatch(
  correlationId: string,
  deploymentSlug: string,
  deviceId?: string
): Promise<boolean> {
  let query = supabase
    .from('mqtt_ingestion')
    .select(
      'id,deployment_slug,device_id,correlation_id,message_type,payload_json,cctv_storage_path,ingest_status'
    )
    .eq('correlation_id', correlationId)
    .eq('deployment_slug', deploymentSlug)
    .in('ingest_status', ['parsed_ok', 'storage_uploaded']);

  if (deviceId) {
    query = query.eq('device_id', deviceId);
  }

  const { data: rows, error } = await query;

  if (error) {
    console.error('[processing] query ingestion error:', error.message);
    return false;
  }

  const list = (rows ?? []) as MqttIngestionRow[];
  const sensorRow = list.find((r) => r.message_type === 'sensor_data');
  const cctvRow = list.find((r) => r.message_type === 'cctv_image');

  if (!sensorRow) return false;

  const payload = sensorRow.payload_json;
  if (!payload) return false;

  const waterLevelCm = Number(payload['water_level_cm'] ?? 0);
  const recordedAt = String(payload['timestamp'] ?? new Date().toISOString());
  const resolvedDeviceId = sensorRow.device_id;
  const slug = sensorRow.deployment_slug;

  const config = await getDeviceConfig(slug, resolvedDeviceId);
  if (!config) {
    console.error('[processing] No device config found for', slug, resolvedDeviceId);
    return false;
  }

  const waterStatus = calcWaterStatus(waterLevelCm, config);

  const { data: reading, error: insertErr } = await supabase
    .from('sensor_readings')
    .insert({
      deployment_slug: slug,
      device_id: resolvedDeviceId,
      recorded_at: recordedAt,
      water_level_cm: waterLevelCm,
      water_status: waterStatus,
      cctv_image_path: cctvRow?.cctv_storage_path ?? null,
      cctv_captured_at: cctvRow ? recordedAt : null,
      rssi: typeof payload['rssi'] === 'number' ? payload['rssi'] : null,
      battery_pct:
        typeof payload['battery_pct'] === 'number' ? payload['battery_pct'] : null,
      correlation_id: correlationId,
    })
    .select('id')
    .single();

  if (insertErr) {
    console.error('[processing] INSERT sensor_readings failed:', insertErr.message);
    return false;
  }

  const ingestionIds = list.map((r) => r.id);
  await supabase
    .from('mqtt_ingestion')
    .update({ ingest_status: 'dispatched_to_core' })
    .in('id', ingestionIds);

  console.log(
    `[processing] sensor_readings INSERT OK — device=${resolvedDeviceId} level=${waterLevelCm}cm status=${waterStatus}`
  );

  if (!reading?.id) return true;

  const notify = shouldNotify(slug, resolvedDeviceId, waterLevelCm, waterStatus, config);
  if (notify) {
    const dep = await getDeploymentNotifyRow(slug);
    // Kamera IP (Hikvision via Tailscale): snapshot kejadian memakai main stream (101);
    // snapshot berkala ada di loop terpisah (sub stream 102).
    let cctvPath = cctvRow?.cctv_storage_path ?? null;
    if (!cctvPath && config.cctv_local_ip) {
      cctvPath = await captureSnapshot({
        host: config.cctv_local_ip,
        deploymentSlug: slug,
        deviceId: resolvedDeviceId,
      });
      if (cctvPath) {
        const { error: camErr } = await supabase
          .from('sensor_readings')
          .update({ cctv_image_path: cctvPath, cctv_captured_at: new Date().toISOString() })
          .eq('id', reading.id);
        if (camErr) console.error('[processing] UPDATE cctv_image_path gagal:', camErr.message);
      }
    }
    const selisih_cm = computeSelisihCmAboveWaspada(waterLevelCm, config.threshold_waspada_cm);
    const event: NotificationEvent = {
      reading_id: reading.id as string,
      deployment_slug: slug,
      device_id: resolvedDeviceId,
      location_name: config.location_name,
      device_display_name: config.display_name,
      water_level_cm: waterLevelCm,
      water_status: waterStatus,
      cctv_image_path: cctvPath,
      recorded_at: recordedAt,
      deployment_display_name: dep?.display_name ?? slug,
      read_interval_sec: config.read_interval_sec,
      threshold_waspada_cm: config.threshold_waspada_cm,
      threshold_siaga_cm: config.threshold_siaga_cm,
      threshold_bahaya_cm: config.threshold_bahaya_cm,
      selisih_cm,
      contact_petugas: dep?.contact_petugas ?? null,
      contact_bpbd: dep?.contact_bpbd ?? null,
      contact_posko: dep?.contact_posko ?? null,
    };
    const sent = await notifyGateway(ENV.GATEWAY_URL, event);
    console.log(
      `[processing] notif ${sent ? 'dikirim ke gateway' : 'GAGAL dikirim ke gateway'} — device=${resolvedDeviceId} status=${waterStatus}`
    );
  }

  return true;
}

function scheduleDispatch(
  correlationId: string,
  deploymentSlug: string,
  deviceId?: string
) {
  const key = `${deploymentSlug}:${correlationId}`;
  metrics.dispatch_scheduled++;

  const existing = dispatchTimers.get(key);
  if (existing) clearTimeout(existing);

  dispatchTimers.set(
    key,
    setTimeout(() => {
      dispatchTimers.delete(key);
      void runDispatch(correlationId, deploymentSlug, deviceId);
    }, DISPATCH_DEBOUNCE_MS)
  );
}

async function runDispatch(
  correlationId: string,
  deploymentSlug: string,
  deviceId?: string
) {
  const key = `${deploymentSlug}:${correlationId}`;
  if (dispatchInFlight.has(key)) return;

  dispatchInFlight.add(key);
  let ok = false;
  try {
    ok = await tryDispatch(correlationId, deploymentSlug, deviceId);
    if (ok) metrics.dispatch_ok++;
  } finally {
    dispatchInFlight.delete(key);
  }

  if (ok) {
    dispatchRetryCounts.delete(key);
    return;
  }

  const attempt = (dispatchRetryCounts.get(key) ?? 0) + 1;
  if (attempt > MAX_DISPATCH_RETRIES) {
    dispatchRetryCounts.delete(key);
    console.error(
      `[processing] dispatch gave up after ${MAX_DISPATCH_RETRIES} retries — corr=${correlationId} slug=${deploymentSlug} deviceId=${deviceId ?? '(none)'}`
    );
    return;
  }
  dispatchRetryCounts.set(key, attempt);
  setTimeout(() => void runDispatch(correlationId, deploymentSlug, deviceId), DISPATCH_RETRY_DELAY_MS);
}

/** Polling fallback: cek staging untuk correlation_id yang belum di-dispatch */
async function pollPending() {
  const { data, error } = await supabase
    .from('mqtt_ingestion')
    .select('correlation_id,deployment_slug,device_id')
    .in('ingest_status', ['parsed_ok', 'storage_uploaded'])
    .order('received_at', { ascending: true })
    .limit(100);

  if (error || !data?.length) return;

  const seen = new Set<string>();
  for (const row of data) {
    const key = `${row.deployment_slug}:${row.correlation_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      scheduleDispatch(
        row.correlation_id as string,
        row.deployment_slug as string,
        row.device_id as string | undefined
      );
    }
  }
}

// Always sweep, even while Realtime is healthy: it's the only true safety net for a row
// whose retries (scheduleDispatch/runDispatch) exhausted without ever finding it — see
// 2026-09-03 investigation. realtimeHealthy only affects the *metrics* label, not whether
// the sweep runs.
async function pollIfNeeded() {
  if (realtimeHealthy) {
    metrics.poll_ran_realtime_healthy++;
  } else {
    metrics.poll_ran_realtime_unhealthy++;
  }
  await pollPending();
}

function startRealtime() {
  supabase
    .channel('ingestion-trigger')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'sijagakali', table: 'mqtt_ingestion' },
      (payload) => {
        const row = payload.new as Partial<MqttIngestionRow>;
        if (!row.correlation_id || !row.deployment_slug) return;
        scheduleDispatch(row.correlation_id, row.deployment_slug, row.device_id);
      }
    )
    .subscribe((status) => {
      const wasHealthy = realtimeHealthy;
      realtimeHealthy = status === 'SUBSCRIBED';
      console.log('[processing] Realtime status:', status);
      if (realtimeHealthy && !wasHealthy) {
        pollPending().catch(console.error);
      }
    });
}

/** Cek jadwal snapshot berkala tiap menit; interval per device diatur admin (snapshot_interval_min). */
const SNAPSHOT_TICK_MS = 60_000;
/** Percobaan terakhir per device (termasuk yang gagal) — kamera mati tidak dicoba ulang tiap menit. */
const lastSnapshotAttempt = new Map<string, number>();
let snapshotTickRunning = false;

async function runPeriodicSnapshots() {
  if (snapshotTickRunning) return;
  snapshotTickRunning = true;
  try {
    const { data, error } = await supabase
      .from('device_configs')
      .select('deployment_slug,device_id,cctv_local_ip,snapshot_interval_min,last_snapshot_at')
      .eq('is_active', true)
      .not('cctv_local_ip', 'is', null)
      .gt('snapshot_interval_min', 0);
    if (error) {
      console.error('[processing] query snapshot berkala gagal:', error.message);
      return;
    }
    const now = Date.now();
    for (const row of data ?? []) {
      const host = String(row.cctv_local_ip ?? '').trim();
      const interval = Number(row.snapshot_interval_min);
      const key = `${row.deployment_slug}:${row.device_id}`;
      if (!host) continue;
      if (!isSnapshotDue(row.last_snapshot_at as string | null, interval, now)) continue;
      if (!isSnapshotDue(lastSnapshotAttempt.get(key), interval, now)) continue;
      lastSnapshotAttempt.set(key, now);
      const path = await captureSnapshot({
        host,
        deploymentSlug: row.deployment_slug as string,
        deviceId: row.device_id as string,
        channel: 102, // sub stream: berkala harus kecil (hemat Storage)
      });
      if (path) console.log(`[processing] snapshot berkala OK — device=${row.device_id}`);
    }
  } finally {
    snapshotTickRunning = false;
  }
}

setInterval(() => {
  void runPeriodicSnapshots();
}, SNAPSHOT_TICK_MS);

/**
 * Peringatan WA saat data sensor berhenti masuk (sensor gangguan / perangkat offline) dan saat pulih.
 * Firmware tidak mengirim data palsu saat gagal baca, jadi "diam" harus dilaporkan.
 */
const SENSOR_HEALTH_TICK_MS = 60_000;
// ponytail: status terakhir yang sudah diumumkan/dicatat, di memori — restart dalam 24 jam pertama gangguan = satu peringatan ulang.
const reportedHealth = new Map<string, SensorHealth>();
let healthTickRunning = false;

async function checkSensorHealth() {
  if (healthTickRunning) return;
  healthTickRunning = true;
  try {
    const { data: devices, error } = await supabase
      .from('device_configs')
      .select('deployment_slug,device_id,location_name,display_name,read_interval_sec,last_seen_at')
      .eq('is_active', true);
    if (error) {
      console.error('[processing] query kesehatan sensor gagal:', error.message);
      return;
    }
    for (const d of devices ?? []) {
      const { data: latest } = await supabase
        .from('sensor_readings')
        .select('recorded_at')
        .eq('deployment_slug', d.deployment_slug)
        .eq('device_id', d.device_id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const lastReadingAt = (latest?.recorded_at as string | undefined) ?? null;
      const health = sensorHealth({
        lastReadingAt,
        lastSeenAt: d.last_seen_at as string | null,
        readIntervalSec: Number(d.read_interval_sec),
      });
      const key = `${d.deployment_slug}:${d.device_id}`;
      const previous = reportedHealth.get(key) ?? 'ok';
      const action = healthTransition(previous, health, lastReadingAt);
      if (action === 'none' || !lastReadingAt || health === 'unknown') continue;
      if (action === 'record') {
        reportedHealth.set(key, health);
        console.log(`[processing] kesehatan sensor ${key}: ${health} sejak ${lastReadingAt} (gangguan lama, tanpa WA)`);
        continue;
      }

      const postName = (d.display_name as string | null) || (d.location_name as string);
      const sent = await notifyGatewayText(
        ENV.GATEWAY_URL,
        formatSensorHealthMessage(health, postName, lastReadingAt)
      );
      // Belum terkirim (WA belum siap / gateway mati) → coba lagi menit berikutnya.
      if (sent) reportedHealth.set(key, health);
      console.log(`[processing] kesehatan sensor ${key}: ${previous} → ${health} (WA ${sent ? 'terkirim' : 'GAGAL'})`);
    }
  } finally {
    healthTickRunning = false;
  }
}

setInterval(() => {
  void checkSensorHealth();
}, SENSOR_HEALTH_TICK_MS);

setInterval(() => {
  console.log('[processing] metrics', JSON.stringify(metrics));
}, 5 * 60_000);

setInterval(() => {
  void pollIfNeeded();
}, POLL_INTERVAL_MS);

startRealtime();

pollPending().catch(console.error);

console.log(
  `[processing] data-processing started (poll=${POLL_INTERVAL_MS}ms debounce=${DISPATCH_DEBOUNCE_MS}ms deployment=${defaultDeployment})`
);
