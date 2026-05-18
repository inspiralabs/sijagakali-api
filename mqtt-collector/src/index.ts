import 'dotenv/config';
import { createMqttClient, getSupabase, getSupabaseStorage, ENV } from '@sijagaair/shared';
import {
  TOPICS,
  extractDeviceId,
  type SensorDataPayload,
  type CctvMetaPayload,
} from '@sijagaair/shared';
import { format } from 'date-fns';

const supabase = getSupabase();
const supabaseStorage = getSupabaseStorage();
const bucket = ENV.SUPABASE_STORAGE_BUCKET_CCTV_IMAGES;
const defaultDeployment = ENV.DEFAULT_DEPLOYMENT_SLUG;
const lastSeenThrottleMs = ENV.LAST_SEEN_THROTTLE_MS;

/** device key → timestamp ms terakhir UPDATE last_seen_at ke DB */
const lastSeenUpdatedAt = new Map<string, number>();

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

const client = createMqttClient('collector');

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
    if (topic.endsWith('/sensor/data')) {
      await handleSensorData(topic, payload);
    } else if (topic.endsWith('/cctv/image')) {
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

async function handleSensorData(topic: string, payload: Buffer) {
  const deviceId = extractDeviceId(topic);
  if (!deviceId) return;

  let data: SensorDataPayload;
  try {
    data = JSON.parse(payload.toString('utf8')) as SensorDataPayload;
  } catch {
    console.error('[collector] sensor/data JSON parse error for device', deviceId);
    await insertIngestionFailed(deviceId, 'sensor_data', null, 'JSON parse error');
    return;
  }

  const deploymentSlug = data.deployment_slug ?? defaultDeployment;

  const { error } = await supabase.from('mqtt_ingestion').insert({
    deployment_slug: deploymentSlug,
    device_id: deviceId,
    correlation_id: data.correlation_id,
    message_type: 'sensor_data',
    payload_json: data as unknown as Record<string, unknown>,
    ingest_status: 'parsed_ok',
  });

  if (error) {
    console.error('[collector] INSERT sensor_data failed:', error.message);
  } else {
    console.log(`[collector] sensor_data OK — device=${deviceId} corr=${data.correlation_id}`);
  }
}

async function handleCctvImage(topic: string, payload: Buffer) {
  const deviceId = extractDeviceId(topic);
  if (!deviceId) return;

  const dateFolder = format(new Date(), 'yyyy-MM-dd');
  const ts = Math.floor(Date.now() / 1000);
  const filePath = `${defaultDeployment}/${deviceId}/${dateFolder}/${ts}_${deviceId}.jpg`;

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
    const status = JSON.parse(payload.toString('utf8')) as { deployment_slug?: string; timestamp?: string };
    const deploymentSlug = status.deployment_slug ?? defaultDeployment;

    const throttleKey = `${deploymentSlug}:${deviceId}`;
    const now = Date.now();
    const lastUpdate = lastSeenUpdatedAt.get(throttleKey) ?? 0;
    if (now - lastUpdate < lastSeenThrottleMs) return;

    const { error } = await supabase
      .from('device_configs')
      .update({ last_seen_at: status.timestamp ?? new Date().toISOString() })
      .eq('deployment_slug', deploymentSlug)
      .eq('device_id', deviceId);

    if (error) {
      console.error('[collector] UPDATE last_seen_at failed:', error.message);
    } else {
      lastSeenUpdatedAt.set(throttleKey, now);
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
