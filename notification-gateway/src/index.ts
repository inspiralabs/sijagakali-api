import 'dotenv/config';
import { createRequire } from 'module';
import Fastify from 'fastify';
import { getSupabaseStorage, getSupabase, ENV, type NotificationEvent } from '@sijagaair/shared';
import { notifEmitter } from '../../data-processing/src/index.js';
import { getWhatsAppClient, isWhatsAppReady, resolveChannelTarget } from './whatsappClient.js';

// whatsapp-web.js adalah CommonJS — harus di-require
const require = createRequire(import.meta.url);
const { MessageMedia } = require('whatsapp-web.js') as typeof import('whatsapp-web.js');

const supabase = getSupabase();
const supabaseStorage = getSupabaseStorage();
const bucket = ENV.SUPABASE_STORAGE_BUCKET_CCTV_IMAGES;

// ─────────────────────────────────────────────────────────────────────────────
// Cache template pesan kustom per deployment — TTL 5 menit
// Agar perubahan template dari admin UI berlaku tanpa restart gateway.
// ─────────────────────────────────────────────────────────────────────────────
const TEMPLATE_TTL_MS = 5 * 60 * 1000; // 5 menit

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

const templateCache = new Map<string, CacheEntry>();

async function getTemplate(deploymentSlug: string): Promise<string | null> {
  const entry = templateCache.get(deploymentSlug);
  if (entry && Date.now() < entry.expiresAt) {
    return entry.value;
  }
  const { data } = await supabase
    .from('deployments')
    .select('whatsapp_message_template')
    .eq('slug', deploymentSlug)
    .maybeSingle();
  const tmpl = data?.whatsapp_message_template ?? null;
  templateCache.set(deploymentSlug, { value: tmpl, expiresAt: Date.now() + TEMPLATE_TTL_MS });
  return tmpl;
}

/** Paksa refresh cache deployment tertentu (dipanggil setelah template diubah). */
function invalidateTemplateCache(deploymentSlug: string) {
  templateCache.delete(deploymentSlug);
}

// ─────────────────────────────────────────────────────────────────────────────
// Format pesan — template kustom atau default
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  normal:  'Siaga 4 — Normal',
  waspada: 'Siaga 3 — Waspada',
  siaga:   'Siaga 2 — Siaga',
  bahaya:  'Siaga 1 — BAHAYA',
};

function formatMessage(
  event: NotificationEvent,
  template: string | null,
  prefix = '',
): string {
  const ts = new Date(event.recorded_at);
  const tanggal = ts.toLocaleDateString('id-ID', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta',
  });
  const pad = (n: number) => String(n).padStart(2, '0');
  const wib = new Date(ts.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const jam = `${pad(wib.getHours())}:${pad(wib.getMinutes())}:${pad(wib.getSeconds())}`;
  const waktu = `${tanggal} ${jam}`;

  const statusLabel = STATUS_LABEL[event.water_status] ?? event.water_status.toUpperCase();
  const levelM = (event.water_level_cm / 100).toFixed(2);
  const dashboardUrl = ENV.DASHBOARD_URL || `${ENV.ALLOWED_ORIGIN}/public`;

  let text: string;

  if (template) {
    text = template
      .replace(/{lokasi}/g, event.location_name)
      .replace(/{level_cm}/g, event.water_level_cm.toFixed(1))
      .replace(/{level_m}/g, levelM)
      .replace(/{status}/g, statusLabel)
      .replace(/{waktu}/g, waktu)
      .replace(/{dashboard_url}/g, dashboardUrl);
  } else {
    const lines = [
      '*SiJagaAir EWS Bojong Kulur*',
      'Laporan Tinggi Muka Air',
      '',
      `Lokasi   : ${event.location_name}`,
      `Waktu    : ${waktu}`,
      '',
      'Laporan:',
      `Ketinggian : ${levelM} m (${event.water_level_cm.toFixed(1)} cm)`,
      `Status     : ${statusLabel}`,
      '',
      `Dashboard  : ${dashboardUrl}`,
    ];
    text = lines.join('\n');
  }

  return prefix ? `${prefix}\n${text}` : text;
}

async function getSignedImageUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabaseStorage.storage
    .from(bucket)
    .createSignedUrl(storagePath, 3600);
  if (error) {
    console.error('[notification-gateway] signed URL error:', error.message);
    return null;
  }
  return data.signedUrl;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core: kirim notifikasi ke WhatsApp Channel
// ─────────────────────────────────────────────────────────────────────────────
async function sendToChannel(message: string, imageUrl: string | null): Promise<{ ok: boolean; error?: string }> {
  if (!isWhatsAppReady()) {
    return { ok: false, error: 'WhatsApp client not ready' };
  }

  const channelTarget = await resolveChannelTarget(ENV.WHATSAPP_CHANNEL_ID);
  if (!channelTarget) {
    return { ok: false, error: 'Tidak ada WhatsApp Channel target yang ditemukan' };
  }

  const wa = await getWhatsAppClient();
  try {
    if (imageUrl) {
      const media = await MessageMedia.fromUrl(imageUrl, { unsafeMime: true });
      await wa.sendMessage(channelTarget, media, { caption: message });
      console.log(`[notification-gateway] Terkirim (gambar+caption) ke channel ${channelTarget}`);
    } else {
      await wa.sendMessage(channelTarget, message);
      console.log(`[notification-gateway] Terkirim (teks) ke channel ${channelTarget}`);
    }
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[notification-gateway] Kirim gagal:', msg);
    return { ok: false, error: msg };
  }
}

async function processNotification(event: NotificationEvent) {
  const template = await getTemplate(event.deployment_slug);
  const message = formatMessage(event, template);
  const imageUrl = event.cctv_image_path
    ? await getSignedImageUrl(event.cctv_image_path)
    : null;

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

// ─────────────────────────────────────────────────────────────────────────────
// HTTP server internal — untuk test manual dari admin UI
// ─────────────────────────────────────────────────────────────────────────────
interface SendTestBody {
  device_id: string;
  deployment_slug?: string;
  water_level_cm: number;
  water_status: string;
  location_name?: string;
  cctv_signed_url?: string | null;
  template?: string | null;
}

const gatewayApp = Fastify({ logger: false });

gatewayApp.post<{ Body: SendTestBody }>('/send-test', async (req, reply) => {
  const {
    device_id,
    deployment_slug,
    water_level_cm,
    water_status,
    location_name,
    cctv_signed_url,
    template,
  } = req.body;

  const slug = deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;

  // Paksa refresh cache agar template terbaru dari DB dipakai
  invalidateTemplateCache(slug);
  const resolvedTemplate = template !== undefined ? template : await getTemplate(slug);

  const fakeEvent: NotificationEvent = {
    reading_id: `test-${Date.now()}`,
    deployment_slug: slug,
    device_id,
    location_name: location_name ?? device_id,
    water_level_cm,
    water_status: water_status as NotificationEvent['water_status'],
    cctv_image_path: null,
    recorded_at: new Date().toISOString(),
  };

  const message = formatMessage(fakeEvent, resolvedTemplate, '[TEST]');

  const result = await sendToChannel(message, cctv_signed_url ?? null);

  if (!result.ok) {
    return reply.code(500).send({ error: result.error ?? 'Gagal mengirim' });
  }

  return reply.send({ ok: true });
});

/**
 * POST /invalidate-template
 * Body: { deployment_slug: string }
 * Dipanggil oleh api/src/index.ts setelah PATCH /api/deployment/template,
 * agar gateway langsung pakai template terbaru tanpa menunggu TTL cache.
 */
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

// Init WhatsApp — tampilkan QR di terminal jika belum scan
getWhatsAppClient().catch((err) => {
  console.error('[notification-gateway] WhatsApp init error:', err.message);
});

console.log('[notification-gateway] notification-gateway started');
