import type { NotificationEvent } from './types.js';

const VALID_STATUS = new Set(['normal', 'waspada', 'siaga', 'bahaya']);

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Validasi minimal body `POST /notify`; null jika tidak valid. */
export function parseNotificationEvent(body: unknown): NotificationEvent | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!nonEmpty(b.reading_id) || !nonEmpty(b.device_id) || !nonEmpty(b.deployment_slug)) return null;
  if (typeof b.water_status !== 'string' || !VALID_STATUS.has(b.water_status)) return null;
  if (typeof b.water_level_cm !== 'number' || !Number.isFinite(b.water_level_cm)) return null;
  return b as unknown as NotificationEvent;
}

/**
 * Kirim event ke notification-gateway (`POST {gatewayUrl}/notify`).
 * Tidak pernah throw — false bila gateway mati/menolak, agar reading tetap tersimpan.
 */
export async function notifyGateway(
  gatewayUrl: string,
  event: NotificationEvent,
  timeoutMs = 10_000
): Promise<boolean> {
  return postToGateway(`${gatewayUrl}/notify`, event, timeoutMs);
}

/**
 * Kirim teks bebas ke WA Channel (`POST {gatewayUrl}/notify-text`), mis. peringatan sensor gangguan.
 * true hanya bila gateway benar-benar mengirim — pemanggil bisa mencoba lagi bila false.
 */
export async function notifyGatewayText(
  gatewayUrl: string,
  message: string,
  timeoutMs = 30_000
): Promise<boolean> {
  return postToGateway(`${gatewayUrl}/notify-text`, { message }, timeoutMs);
}

async function postToGateway(url: string, body: unknown, timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error(`[notifyGateway] gateway membalas HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[notifyGateway] gagal menghubungi gateway:', err instanceof Error ? err.message : String(err));
    return false;
  }
}
