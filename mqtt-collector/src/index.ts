import 'dotenv/config';
import { join } from 'node:path';
import { flushSpool, saveDurably, type InsertFn } from './durableInsert.js';
import { createMqttClient, getSupabase, getSupabaseStorage, ENV, cctvStoragePath } from '@sijagakali/shared';
import {
  TOPICS,
  extractDeviceId,
  type SensorDataPayload,
  type SensorStatusPayload,
  type CctvMetaPayload,
} from '@sijagakali/shared';

const supabase = getSupabase();
const supabaseStorage = getSupabaseStorage();
const bucket = ENV.SUPABASE_STORAGE_BUCKET_CCTV_IMAGES;
const defaultDeployment = ENV.DEFAULT_DEPLOYMENT_SLUG;
const lastSeenThrottleMs = ENV.LAST_SEEN_THROTTLE_MS;

/** device key → timestamp ms terakhir UPDATE last_seen_at ke DB */
const lastSeenUpdatedAt = new Map<string, number>();
/** device key → last_error terakhir yang tersimpan di DB (tidak ada = belum pernah ditulis) */
const lastErrorWritten = new Map<string, string | null>();

/**
 * Peta sementara correlation_id → deployment_slug dari pesan cctv/meta opsional.
 * TTL: dibuang jika lebih dari 5 menit.
 */
const correlationMeta = new Map<string, { deployment_slug: string; timestamp: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of correlationMeta) {
    if (now - v.timestamp > 5 * 60_000) correlationMeta.delete(k);
  }
}, 60_000);

// Sesi persisten: selama collector mati/restart (mis. deploy), broker menahan pesan QoS 1 untuknya.
const client = createMqttClient('collector', { persistentSession: true });

// sensor/data diproses di handleMessage, bukan di 'message': mqtt.js baru mengirim PUBACK ke broker
// setelah callback ini dipanggil. Jadi broker baru menganggap pesan selesai setelah data aman di DB
// atau spool; selain itu pesan tetap di broker dan dikirim ulang saat collector tersambung lagi.
client.handleMessage = (packet, callback) => {
  if (!packet.topic.endsWith('/sensor/data')) return callback();
  handleSensorData(packet.topic, packet.payload as Buffer).then(
    (safe) => {
      if (safe) return callback();
      // DB dan disk sama-sama gagal: jangan PUBACK. Restart (docker) → broker mengirim ulang.
      console.error('[collector] sensor/data tidak bisa disimpan di mana pun — restart');
      process.exit(1);
    },
    (err) => {
      console.error('[collector] sensor/data handler error — restart', err);
      process.exit(1);
    }
  );
};

const spoolFile = join(process.env.COLLECTOR_SPOOL_DIR ?? 'spool', 'mqtt_ingestion.jsonl');
const insertIngestion: InsertFn = (row) =>
  supabase.from('mqtt_ingestion').insert(row).abortSignal(AbortSignal.timeout(5_000));

let flushing = false;
async function flushSpoolTick() {
  if (flushing) return;
  flushing = true;
  try {
    const saved = await flushSpool(insertIngestion, spoolFile);
    if (saved) console.log(`[collector] spool: ${saved} data susulan tersimpan ke DB`);
  } catch (err) {
    console.error('[collector] flush spool gagal:', err instanceof Error ? err.message : String(err));
  } finally {
    flushing = false;
  }
}
setInterval(() => void flushSpoolTick(), 60_000);
void flushSpoolTick();

client.on('connect', () => {
  client.subscribe(
    [TOPICS.SENSOR_DATA, TOPICS.CCTV_IMAGE, TOPICS.CCTV_META, TOPICS.SENSOR_STATUS],
    { qos: 1 },
    (err) => {
      if (err) console.error('[collector] Subscribe error:', err.message);
      else console.log('[collector] Subscribed to all topics');
    }
  );
});

client.on('message', async (topic: string, payload: Buffer) => {
  try {
    if (topic.endsWith('/cctv/image')) {
      await handleCctvImage(topic, payload);
    } else if (topic.endsWith('/cctv/meta')) {
      handleCctvMeta(topic, payload);
    } else if (topic.endsWith('/sensor/status')) {
      await handleSensorStatus(topic, payload);
    }
  } catch (err) {
    console.error('[collector] Unhandled error on topic', topic, err);
  }
});

/** @returns true = data aman (DB/spool) atau tidak layak dikirim ulang (rusak) → boleh PUBACK */
async function handleSensorData(topic: string, payload: Buffer): Promise<boolean> {
  const deviceId = extractDeviceId(topic);
  if (!deviceId) return true;

  let data: SensorDataPayload;
  try {
    data = JSON.parse(payload.toString('utf8')) as SensorDataPayload;
  } catch {
    console.error('[collector] sensor/data JSON parse error for device', deviceId);
    await insertIngestionFailed(deviceId, 'sensor_data', null, 'JSON parse error');
    return true;
  }

  const deploymentSlug = data.deployment_slug ?? defaultDeployment;

  const saved = await saveDurably(insertIngestion, {
    deployment_slug: deploymentSlug,
    device_id: deviceId,
    correlation_id: data.correlation_id,
    message_type: 'sensor_data',
    payload_json: data as unknown as Record<string, unknown>,
    ingest_status: 'parsed_ok',
  }, spoolFile);

  if (saved !== 'failed') {
    console.log(`[collector] sensor_data ${saved === 'db' ? 'OK' : 'SPOOL'} — device=${deviceId} corr=${data.correlation_id}`);
  }
  return saved !== 'failed';
}

async function handleCctvImage(topic: string, payload: Buffer) {
  const deviceId = extractDeviceId(topic);
  if (!deviceId) return;

  const filePath = cctvStoragePath(defaultDeployment, deviceId);

  const { error: uploadError } = await supabaseStorage.storage
    .from(bucket)
    .upload(filePath, payload, { contentType: 'image/jpeg', upsert: false });

  if (uploadError) {
    console.error('[collector] Storage upload failed:', uploadError.message);
    await insertIngestionFailed(deviceId, 'cctv_image', null, uploadError.message);
    return;
  }

  // Coba cari correlation_id dari map meta; jika tidak ada, buat UUID baru
  const metaEntry = [...correlationMeta.entries()].find(([, v]) => v.timestamp > Date.now() - 30_000);
  const correlation_id = metaEntry?.[0] ?? crypto.randomUUID();
  const deploymentSlug = metaEntry ? metaEntry[1].deployment_slug : defaultDeployment;

  const { error } = await supabase.from('mqtt_ingestion').insert({
    deployment_slug: deploymentSlug,
    device_id: deviceId,
    correlation_id,
    message_type: 'cctv_image',
    cctv_storage_path: filePath,
    ingest_status: 'storage_uploaded',
  });

  if (error) {
    console.error('[collector] INSERT cctv_image failed:', error.message);
  } else {
    console.log(`[collector] cctv_image OK — device=${deviceId} path=${filePath}`);
  }
}

function handleCctvMeta(topic: string, payload: Buffer) {
  const deviceId = extractDeviceId(topic);
  if (!deviceId) return;

  try {
    const meta = JSON.parse(payload.toString('utf8')) as CctvMetaPayload;
    if (meta.correlation_id) {
      correlationMeta.set(meta.correlation_id, {
        deployment_slug: meta.deployment_slug ?? defaultDeployment,
        timestamp: Date.now(),
      });
    }
  } catch {
    console.warn('[collector] cctv/meta parse error for device', deviceId);
  }
}

async function handleSensorStatus(topic: string, payload: Buffer) {
  const deviceId = extractDeviceId(topic);
  if (!deviceId) return;

  try {
    const status = JSON.parse(payload.toString('utf8')) as SensorStatusPayload;
    const deploymentSlug = status.deployment_slug ?? defaultDeployment;
    const lastError = status.last_error ?? null;

    const throttleKey = `${deploymentSlug}:${deviceId}`;
    const now = Date.now();
    const lastUpdate = lastSeenUpdatedAt.get(throttleKey) ?? 0;
    // Sensor mulai gagal / pulih ditulis segera agar dashboard tidak menunggu throttle.
    // Teks galat berubah tiap siklus (penghitung xN), jadi yang dibandingkan hanya ada/tidaknya galat.
    const prevError = lastErrorWritten.get(throttleKey);
    const errorFlipped = prevError === undefined || (prevError === null) !== (lastError === null);
    if (!errorFlipped && now - lastUpdate < lastSeenThrottleMs) return;

    const { error } = await supabase
      .from('device_configs')
      .update({ last_seen_at: status.timestamp ?? new Date().toISOString(), last_error: lastError })
      .eq('deployment_slug', deploymentSlug)
      .eq('device_id', deviceId);

    if (error) {
      console.error('[collector] UPDATE last_seen_at failed:', error.message);
    } else {
      lastSeenUpdatedAt.set(throttleKey, now);
      lastErrorWritten.set(throttleKey, lastError);
    }
  } catch {
    console.warn('[collector] sensor/status parse error for device', deviceId);
  }
}

async function insertIngestionFailed(
  deviceId: string,
  messageType: 'sensor_data' | 'cctv_image',
  correlationId: string | null,
  errorMessage: string
) {
  await supabase.from('mqtt_ingestion').insert({
    deployment_slug: defaultDeployment,
    device_id: deviceId,
    correlation_id: correlationId ?? crypto.randomUUID(),
    message_type: messageType,
    ingest_status: 'failed',
    error_message: errorMessage,
  });
}

console.log('[collector] Starting mqtt-collector service...');
