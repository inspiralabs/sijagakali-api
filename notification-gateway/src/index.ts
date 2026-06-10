import 'dotenv/config';
import { createRequire } from 'module';
import Fastify from 'fastify';
import {
  getSupabaseStorage,
  getSupabase,
  ENV,
  notifEmitter,
  type NotificationEvent,
  type WeatherNotificationEvent,
  type DeploymentWaRow,
  formatWaMessage,
  formatWeatherWaMessage,
  buildSyntheticNotificationEvent,
  createCctvSignedUrlFlexible,
} from '@sijagaair/shared';
import { getWhatsAppClient, isWhatsAppReady, resolveChannelTarget } from './whatsappClient.js';

const require = createRequire(import.meta.url);
const { MessageMedia } = require('whatsapp-web.js') as typeof import('whatsapp-web.js');

const supabase = getSupabase();
const supabaseStorage = getSupabaseStorage();
const bucket = ENV.SUPABASE_STORAGE_BUCKET_CCTV_IMAGES;

const TEMPLATE_TTL_MS = 5 * 60 * 1000;

const DEPLOYMENT_WA_SELECT =
  'display_name,whatsapp_message_template,wa_template_normal,wa_template_waspada,wa_template_siaga,wa_template_bahaya,wa_template_weather_nowcast,wa_template_weather_heavy_rain,contact_petugas,contact_bpbd,contact_posko';

interface CacheEntry {
  value: Partial<DeploymentWaRow> | null;
  expiresAt: number;
}

const templateCache = new Map<string, CacheEntry>();

async function getDeploymentWaRow(deploymentSlug: string): Promise<Partial<DeploymentWaRow> | null> {
  const entry = templateCache.get(deploymentSlug);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.value;
  }
  const { data, error } = await supabase
    .from('deployments')
    .select(DEPLOYMENT_WA_SELECT)
    .eq('slug', deploymentSlug)
    .maybeSingle();

  if (error) {
    console.error('[notification-gateway] getDeploymentWaRow:', error.message);
    templateCache.set(deploymentSlug, { value: null, expiresAt: Date.now() + TEMPLATE_TTL_MS });
    return null;
  }

  const row = (data ?? null) as Partial<DeploymentWaRow> | null;
  templateCache.set(deploymentSlug, { value: row, expiresAt: Date.now() + TEMPLATE_TTL_MS });
  return row;
}

function invalidateTemplateCache(deploymentSlug: string) {
  templateCache.delete(deploymentSlug);
}

function dashboardUrl(): string {
  return ENV.DASHBOARD_URL || `${ENV.ALLOWED_ORIGIN}/public`;
}

async function getSignedImageUrl(storagePath: string, deviceId: string): Promise<string | null> {
  return createCctvSignedUrlFlexible(supabaseStorage, bucket, storagePath, deviceId);
}

async function sendToChannel(
  message: string,
  imageUrl: string | null
): Promise<{ ok: boolean; error?: string; imageAttached: boolean; imageFallbackUsed?: boolean }> {
  if (!isWhatsAppReady()) {
    return { ok: false, error: 'WhatsApp client not ready', imageAttached: false };
  }

  const channelTarget = await resolveChannelTarget(ENV.WHATSAPP_CHANNEL_ID);
  if (!channelTarget) {
    return { ok: false, error: 'Tidak ada WhatsApp Channel target yang ditemukan', imageAttached: false };
  }

  const wa = await getWhatsAppClient();

  if (imageUrl) {
    try {
      const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
      await wa.sendMessage(channelTarget, media, { caption: message });
      console.log(`[notification-gateway] Terkirim (gambar+caption) ke channel ${channelTarget}`);
      return { ok: true, imageAttached: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[notification-gateway] MessageMedia.fromUrl gagal, fallback teks:', msg);
      try {
        await wa.sendMessage(channelTarget, message);
        console.log(`[notification-gateway] Terkirim (teks saja, fallback) ke channel ${channelTarget}`);
        return { ok: true, imageAttached: false, imageFallbackUsed: true };
      } catch (sendErr) {
        const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
        console.error('[notification-gateway] Kirim teks fallback gagal:', sendMsg);
        return { ok: false, error: sendMsg, imageAttached: false, imageFallbackUsed: true };
      }
    }
  }

  try {
    await wa.sendMessage(channelTarget, message);
    console.log(`[notification-gateway] Terkirim (teks) ke channel ${channelTarget}`);
    return { ok: true, imageAttached: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[notification-gateway] Kirim gagal:', msg);
    return { ok: false, error: msg, imageAttached: false };
  }
}

async function processNotification(event: NotificationEvent) {
  const row = await getDeploymentWaRow(event.deployment_slug);
  const message = formatWaMessage(event, row, dashboardUrl());
  const imageUrl = event.cctv_image_path ? await getSignedImageUrl(event.cctv_image_path, event.device_id) : null;

  const result = await sendToChannel(message, imageUrl);

  const { error: logErr } = await supabase.from('notification_logs').insert({
    reading_id: event.reading_id,
    deployment_slug: event.deployment_slug,
    device_id: event.device_id,
    water_status: event.water_status,
    channel: 'whatsapp',
    status: result.ok ? 'sent' : 'failed',
    error_message: result.error ?? null,
  });

  if (logErr) {
    console.error('[notification-gateway] INSERT notification_logs gagal:', logErr.message);
  }
}

notifEmitter.on('notify', (event: NotificationEvent) => {
  processNotification(event).catch((err) => {
    console.error('[notification-gateway] processNotification unhandled:', err);
  });
});

async function processWeatherNotification(event: WeatherNotificationEvent) {
  const row = await getDeploymentWaRow(event.deployment_slug);
  const message = formatWeatherWaMessage(event, row, dashboardUrl());
  const result = await sendToChannel(message, null);

  const { error: logErr } = await supabase.from('notification_logs').insert({
    reading_id: null,
    deployment_slug: event.deployment_slug,
    device_id: event.device_id,
    water_status: null,
    channel: 'weather',
    status: result.ok ? 'sent' : 'failed',
    error_message: result.error ?? null,
  });

  if (logErr) {
    console.error('[notification-gateway] INSERT weather notification_logs gagal:', logErr.message);
  }
}

notifEmitter.on('weather-notify', (event: WeatherNotificationEvent) => {
  processWeatherNotification(event).catch((err) => {
    console.error('[notification-gateway] processWeatherNotification unhandled:', err);
  });
});

const VALID_STATUS = new Set(['normal', 'waspada', 'siaga', 'bahaya']);

interface SendTestBody {
  device_id: string;
  deployment_slug?: string;
  water_level_cm: number;
  water_status: string;
  location_name?: string;
  cctv_signed_url?: string | null;
  /** Jika diisi, lewati format template dan kirim teks ini (untuk uji manual). */
  message_text?: string | null;
}

const gatewayApp = Fastify({ logger: false });

gatewayApp.post<{ Body: SendTestBody }>('/send-test', async (req, reply) => {
  const { device_id, deployment_slug, water_level_cm, water_status, location_name, cctv_signed_url, message_text } =
    req.body;

  const slug = deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;

  if (!VALID_STATUS.has(water_status)) {
    return reply.code(400).send({ error: 'water_status tidak valid' });
  }

  invalidateTemplateCache(slug);

  const { data: cfg } = await supabase
    .from('device_configs')
    .select(
      'location_name,read_interval_sec,threshold_waspada_cm,threshold_siaga_cm,threshold_bahaya_cm'
    )
    .eq('deployment_slug', slug)
    .eq('device_id', device_id)
    .maybeSingle();

  const depRow = await getDeploymentWaRow(slug);

  const loc = location_name ?? cfg?.location_name ?? device_id;
  const readInterval = cfg?.read_interval_sec ?? 3600;
  const tw = cfg?.threshold_waspada_cm ?? 0;
  const ts = cfg?.threshold_siaga_cm ?? tw;
  const tb = cfg?.threshold_bahaya_cm ?? ts;

  const event = buildSyntheticNotificationEvent(
    {
      deployment_slug: slug,
      device_id,
      location_name: loc,
      water_level_cm,
      water_status: water_status as NotificationEvent['water_status'],
      deployment_display_name: depRow?.display_name ?? slug,
      read_interval_sec: readInterval,
      threshold_waspada_cm: tw,
      threshold_siaga_cm: ts,
      threshold_bahaya_cm: tb,
      contact_petugas: depRow?.contact_petugas ?? null,
      contact_bpbd: depRow?.contact_bpbd ?? null,
      contact_posko: depRow?.contact_posko ?? null,
    },
    { readingIdPrefix: 'test' }
  );

  const url = dashboardUrl();
  const formatted = formatWaMessage(event, depRow, url);
  const message =
    message_text != null && String(message_text).trim().length > 0
      ? `[TEST]\n${String(message_text).trim()}`
      : `[TEST]\n${formatted}`;

  const result = await sendToChannel(message, cctv_signed_url ?? null);

  if (!result.ok) {
    return reply.code(500).send({
      error: result.error ?? 'Gagal mengirim',
      imageAttached: result.imageAttached,
      imageFallbackUsed: result.imageFallbackUsed,
    });
  }

  return reply.send({
    ok: true,
    imageAttached: result.imageAttached,
    imageFallbackUsed: result.imageFallbackUsed ?? false,
  });
});

gatewayApp.post<{ Body: { deployment_slug: string } }>('/invalidate-template', async (req, reply) => {
  const { deployment_slug } = req.body;
  if (deployment_slug) {
    invalidateTemplateCache(deployment_slug);
    console.log(`[notification-gateway] Cache template di-invalidate untuk slug: ${deployment_slug}`);
  }
  return reply.send({ ok: true });
});

const gatewayPort = ENV.GATEWAY_HTTP_PORT;
await gatewayApp.listen({ port: gatewayPort, host: '127.0.0.1' });
console.log(`[notification-gateway] HTTP internal listening on port ${gatewayPort}`);

getWhatsAppClient().catch((err) => {
  console.error('[notification-gateway] WhatsApp init error:', err.message);
});

console.log('[notification-gateway] notification-gateway started');
