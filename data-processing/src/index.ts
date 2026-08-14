import 'dotenv/config';
import {
  getSupabase,
  ENV,
  calcWaterStatus,
  computeSelisihCmAboveWaspada,
  notifEmitter,
  type NotificationEvent,
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
  poll_skipped_realtime: 0,
  poll_ran: 0,
  dispatch_scheduled: 0,
  dispatch_ok: 0,
};

let realtimeHealthy = false;

const dispatchTimers = new Map<string, ReturnType<typeof setTimeout>>();
const dispatchInFlight = new Set<string>();

async function getDeviceConfig(
  deploymentSlug: string,
  deviceId: string
): Promise<DeviceConfigRow | null> {
  const key = `${deploymentSlug}:${deviceId}`;
  if (configCache.has(key)) return configCache.get(key)!;

  const { data, error } = await supabase
    .from('device_configs')
    .select(
      'deployment_slug,device_id,location_name,read_interval_sec,threshold_waspada_cm,threshold_siaga_cm,threshold_bahaya_cm,notify_digest_hours_local,notify_surge_delta_cm,notify_surge_window_min,notify_cooldown_waspada_sec,notify_cooldown_siaga_sec,notify_cooldown_bahaya_sec'
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
    const selisih_cm = computeSelisihCmAboveWaspada(waterLevelCm, config.threshold_waspada_cm);
    const event: NotificationEvent = {
      reading_id: reading.id as string,
      deployment_slug: slug,
      device_id: resolvedDeviceId,
      location_name: config.location_name,
      water_level_cm: waterLevelCm,
      water_status: waterStatus,
      cctv_image_path: cctvRow?.cctv_storage_path ?? null,
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
    notifEmitter.emit('notify', event);
    console.log(
      `[processing] notif event emitted for device=${resolvedDeviceId} status=${waterStatus}`
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
  try {
    const ok = await tryDispatch(correlationId, deploymentSlug, deviceId);
    if (ok) metrics.dispatch_ok++;
  } finally {
    dispatchInFlight.delete(key);
  }
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

async function pollIfNeeded() {
  if (realtimeHealthy) {
    metrics.poll_skipped_realtime++;
    return;
  }
  metrics.poll_ran++;
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
