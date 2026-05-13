import { createRequire } from 'module';
import { ENV } from '@sijagaair/shared';

// whatsapp-web.js adalah CommonJS — harus di-require, bukan di-import langsung
const require = createRequire(import.meta.url);
const { Client, LocalAuth } = require('whatsapp-web.js') as typeof import('whatsapp-web.js');
const qrcode = require('qrcode-terminal') as typeof import('qrcode-terminal');

import type { Client as WaClient } from 'whatsapp-web.js';

let _client: WaClient | null = null;
let _ready = false;

export async function getWhatsAppClient(): Promise<WaClient> {
  if (_client && _ready) return _client;

  const chromePath =
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim() ||
    process.env.CHROME_PATH?.trim() ||
    undefined;

  _client = new Client({
    authStrategy: new LocalAuth({ clientId: 'sijagaair-gateway' }),
    puppeteer: {
      headless: true,
      ...(chromePath ? { executablePath: chromePath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    },
  });

  _client.on('qr', (qr: string) => {
    console.log('[gateway] Scan QR berikut dari WhatsApp > Linked Devices:');
    qrcode.generate(qr, { small: true });
  });

  _client.on('authenticated', () => {
    console.log('[gateway] Autentikasi berhasil.');
  });

  _client.on('auth_failure', (msg: string) => {
    _ready = false;
    console.error('[gateway] Autentikasi gagal:', msg);
  });

  _client.on('ready', async () => {
    _ready = true;
    const wid = (_client as WaClient & { info?: { wid?: { _serialized?: string } } })
      .info?.wid?._serialized;
    console.log('[gateway] WhatsApp client ready. Akun:', wid ?? '—');

    // Tampilkan daftar channel — berguna untuk mencari WHATSAPP_CHANNEL_ID
    const channels = await listChannels();
    if (channels.length) {
      console.log(`[gateway] ${channels.length} channel ditemukan:`);
      channels.forEach((ch) => console.log(`  - ${ch.name} | ${ch.id}`));
    } else {
      console.log('[gateway] Tidak ada WhatsApp Channel yang ditemukan di akun ini.');
      if (ENV.WHATSAPP_OWNER_NUMBER) {
        console.log(`[gateway] Akan fallback ke DM owner: ${ENV.WHATSAPP_OWNER_NUMBER}`);
      }
    }
  });

  _client.on('disconnected', (reason: string) => {
    _ready = false;
    console.warn('[gateway] WhatsApp terputus:', reason);
  });

  await _client.initialize();
  return _client;
}

export function isWhatsAppReady(): boolean {
  return _ready;
}

type ChannelEntry = { id: string; name: string };

/**
 * Ambil semua WhatsApp Channel dari akun yang login.
 * Menggunakan retry (3x, jeda 3 detik) karena channel kadang belum
 * tersedia persis saat event 'ready' dipanggil.
 * Sama dengan getChannelsFromRuntime() di playground/wa-bot.
 */
export async function listChannels(retries = 3, delayMs = 3000): Promise<ChannelEntry[]> {
  if (!_client || !_ready) return [];

  type RawChannel = { id?: { _serialized?: string }; name?: string; formattedTitle?: string };
  type WWebPage = Window & { WWebJS?: { getChannels?: () => Promise<unknown[]> } };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const channels = await (_client as WaClient & {
        pupPage: { evaluate: <T>(fn: () => Promise<T>) => Promise<T> };
      }).pupPage.evaluate(async () => {
        const raw = await (window as WWebPage).WWebJS?.getChannels?.() ?? [];
        return (raw as RawChannel[])
          .map((c) => ({
            id: c.id?._serialized ?? null,
            name: c.name || c.formattedTitle || 'Unknown',
          }))
          .filter((c) => c.id !== null) as Array<{ id: string; name: string }>;
      });

      if (channels.length) return channels;

      console.log(`[gateway] listChannels percobaan ${attempt}/${retries}: belum ada channel, tunggu ${delayMs}ms...`);
    } catch (err) {
      console.warn(`[gateway] listChannels percobaan ${attempt}/${retries} gagal:`, err instanceof Error ? err.message : err);
    }

    if (attempt < retries) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  return [];
}

/**
 * Resolve target pengiriman WhatsApp.
 *
 * Urutan prioritas (sama dengan logika playground wa-bot):
 * 1. WHATSAPP_CHANNEL_ID dari env (mis. "120363426015806462@newsletter") → pakai langsung
 * 2. Auto-detect: channel pertama yang ditemukan di akun (dengan retry)
 * 3. Fallback: DM langsung ke WHATSAPP_OWNER_NUMBER jika tidak ada channel
 * 4. null → log error, tidak kirim
 */
export async function resolveChannelTarget(channelId: string): Promise<string | null> {
  // Prioritas 1 — ID eksplisit dari env
  if (channelId && channelId.endsWith('@newsletter')) {
    console.log('[gateway] Target channel dari env:', channelId);
    return channelId;
  }

  // Prioritas 2 — auto-detect channel pertama
  const channels = await listChannels();
  if (channels.length) {
    const target = channels[0]!.id;
    console.log('[gateway] Auto-detect channel:', channels[0]!.name, '|', target);
    return target;
  }

  // Prioritas 3 — fallback DM ke nomor owner
  const ownerNumber = ENV.WHATSAPP_OWNER_NUMBER?.trim();
  if (ownerNumber) {
    // Normalisasi: "08xxx" atau "+62xxx" → "62xxx@c.us"
    const normalized = ownerNumber
      .replace(/^\+/, '')      // hapus +
      .replace(/^0/, '62');    // 08 → 628
    const target = `${normalized}@c.us`;
    console.warn('[gateway] Tidak ada channel — fallback DM ke owner:', target);
    return target;
  }

  console.error('[gateway] Tidak ada channel dan WHATSAPP_OWNER_NUMBER tidak diisi. Pesan tidak dikirim.');
  return null;
}
