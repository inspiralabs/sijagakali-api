import 'dotenv/config';
import {
  getSupabase,
  ENV,
  calcWaterStatus,
  computeSelisihCmAboveWaspada,
  notifEmitter,
  type NotificationEvent,
} from '@sijagaair/shared';
import { shouldNotify } from './notificationPolicy.js';

const supabase = getSupabase();
const defaultDeployment = ENV.DEFAULT_DEPLOYMENT_SLUG;

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

type DeploymentNotifyRow = {
  display_name: string;
  contact_petugas: string | null;
  contact_bpbd: string | null;
  contact_posko: string | null;
};

async function getDeploymentNotifyRow(deploymentSlug: string): Promise<DeploymentNotifyRow | null> {
  const { data, error } = await supabase
    .from('deployments')
    .select('display_name,contact_petugas,contact_bpbd,contact_posko')
    .eq('slug', deploymentSlug)
    .maybeSingle();

  if (error || !data) {
    if (error) console.error('[processing] getDeploymentNotifyRow error:', error.message);
    return null;
  }
  return data as DeploymentNotifyRow;
}

async function tryDispatch(correlationId: string, deploymentSlug: string) {
  const { data: rows, error } = await supabase
    .from('mqtt_ingestion')
    .select('id,deployment_slug,device_id,correlation_id,message_type,payload_json,cctv_storage_path,ingest_status')
    .eq('correlation_id', correlationId)
    .eq('deployment_slug', deploymentSlug)
    .in('ingest_status', ['parsed_ok', 'storage_uploaded']);

  if (error) {
    console.error('[processing] query ingestion error:', error.message);
    return;
  }

  const list = (rows ?? []) as MqttIngestionRow[];
  const sensorRow = list.find((r) => r.message_type === 'sensor_data');
  const cctvRow = list.find((r) => r.message_type === 'cctv_image');

  if (!sensorRow) return; // belum lengkap atau tidak ada sensor

  const payload = sensorRow.payload_json;
  if (!payload) return;

  const waterLevelCm = Number(payload['water_level_cm'] ?? 0);
  const recordedAt = String(payload['timestamp'] ?? new Date().toISOString());
  const deviceId = sensorRow.device_id;
  const slug = sensorRow.deployment_slug;

  const config = await getDeviceConfig(slug, deviceId);
  if (!config) {
    console.error('[processing] No device config found for', slug, deviceId);
    return;
  }

  const waterStatus = calcWaterStatus(waterLevelCm, config);

  const { data: reading, error: insertErr } = await supabase
    .from('sensor_readings')
    .insert({
      deployment_slug: slug,
      device_id: deviceId,
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
    return;
  }

  // Mark ingestion baris sebagai dispatched
  const ingestionIds = list.map((r) => r.id);
  await supabase
    .from('mqtt_ingestion')
    .update({ ingest_status: 'dispatched_to_core' })
    .in('id', ingestionIds);

  console.log(
    `[processing] sensor_readings INSERT OK — device=${deviceId} level=${waterLevelCm}cm status=${waterStatus}`
  );

  // Evaluasi apakah perlu kirim notifikasi
  if (!reading?.id) return;

  const notify = shouldNotify(slug, deviceId, waterLevelCm, waterStatus, config);
  if (notify) {
    const dep = await getDeploymentNotifyRow(slug);
    const selisih_cm = computeSelisihCmAboveWaspada(waterLevelCm, config.threshold_waspada_cm);
    const event: NotificationEvent = {
      reading_id: reading.id as string,
      deployment_slug: slug,
      device_id: deviceId,
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
    console.log(`[processing] notif event emitted for device=${deviceId} status=${waterStatus}`);
  }
}

/** Polling fallback: cek staging setiap 10 detik untuk correlation_id yang belum di-dispatch */
async function pollPending() {
  const { data, error } = await supabase
    .from('mqtt_ingestion')
    .select('correlation_id,deployment_slug')
    .in('ingest_status', ['parsed_ok', 'storage_uploaded'])
    .order('received_at', { ascending: true })
    .limit(100);

  if (error || !data?.length) return;

  const seen = new Set<string>();
  for (const row of data) {
    const key = `${row.deployment_slug}:${row.correlation_id}`;
    if (!seen.has(key)) {
      seen.add(key);
      await tryDispatch(row.correlation_id as string, row.deployment_slug as string);
    }
  }
}

setInterval(pollPending, 10_000);

// Supabase Realtime — trigger saat baris mqtt_ingestion baru masuk
function startRealtime() {
  supabase
    .channel('ingestion-trigger')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'sijagaair', table: 'mqtt_ingestion' },
      async (payload) => {
        const row = payload.new as Partial<MqttIngestionRow>;
        if (!row.correlation_id || !row.deployment_slug) return;
        await tryDispatch(row.correlation_id, row.deployment_slug);
      }
    )
    .subscribe((status) => {
      console.log('[processing] Realtime status:', status);
    });
}

startRealtime();

// Jalankan polling sekali saat startup untuk menangkap backlog
pollPending().catch(console.error);

console.log('[processing] data-processing service started');
