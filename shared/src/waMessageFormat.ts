import type { NotificationEvent, WaterStatus } from './types.js';
import { BUILTIN_WA_TEMPLATE_BY_STATUS } from './waBuiltinTemplates.js';

/** Baris template dari `deployments` (boleh partial dari query). */
export interface DeploymentWaRow {
  display_name: string;
  whatsapp_message_template: string | null;
  wa_template_normal: string | null;
  wa_template_waspada: string | null;
  wa_template_siaga: string | null;
  wa_template_bahaya: string | null;
  contact_petugas: string | null;
  contact_bpbd: string | null;
  contact_posko: string | null;
}

export const WA_STATUS_LABEL: Record<string, string> = {
  normal: 'Siaga 4 — Normal',
  waspada: 'Siaga 3 — Waspada',
  siaga: 'Siaga 2 — Siaga',
  bahaya: 'Siaga 1 — BAHAYA',
};

export function formatWaktuWib(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  const tanggal = d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
  const pad = (n: number) => String(n).padStart(2, '0');
  const wib = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const jam = `${pad(wib.getHours())}:${pad(wib.getMinutes())}:${pad(wib.getSeconds())}`;
  return `${tanggal} ${jam}`;
}

/** Pilih string template untuk status; null = pakai default bawaan `formatWaMessage`. */
export function pickWaTemplateString(
  status: WaterStatus,
  row: Partial<DeploymentWaRow> | null | undefined
): string | null {
  const legacy = row?.whatsapp_message_template ?? null;
  if (!row) return legacy;

  const pick = (specific: string | null | undefined): string | null =>
    specific && specific.trim().length > 0 ? specific : null;

  if (status === 'normal') return pick(row.wa_template_normal) ?? legacy;
  if (status === 'waspada') return pick(row.wa_template_waspada) ?? legacy;
  if (status === 'siaga') return pick(row.wa_template_siaga) ?? legacy;
  if (status === 'bahaya') {
    return pick(row.wa_template_bahaya) ?? pick(row.wa_template_siaga) ?? legacy;
  }
  return legacy;
}

function dash(s: string | null | undefined): string {
  if (s == null || !String(s).trim()) return '—';
  return String(s);
}

function fmtCm(n: number): string {
  return Number(n).toFixed(1);
}

/** Isi placeholder pada satu string template. */
export function applyWaPlaceholders(
  template: string,
  event: NotificationEvent,
  dashboardUrl: string
): string {
  const statusLabel = WA_STATUS_LABEL[event.water_status] ?? event.water_status.toUpperCase();
  const levelM = (event.water_level_cm / 100).toFixed(2);
  const waktu = formatWaktuWib(event.recorded_at);
  const intervalMin = Math.max(1, Math.round(event.read_interval_sec / 60));
  const selisih = Math.max(0, Math.round(event.selisih_cm));

  let text = template;
  const rep = (k: string, v: string) => {
    text = text.split(k).join(v);
  };

  rep('{nama_pos}', event.location_name);
  rep('{lokasi}', event.location_name);
  rep('{wilayah}', event.deployment_display_name);
  rep('{deployment_slug}', event.deployment_slug);
  rep('{device_id}', event.device_id);
  rep('{level_cm}', fmtCm(event.water_level_cm));
  rep('{level_m}', levelM);
  rep('{status}', statusLabel);
  rep('{waktu}', waktu);
  rep('{dashboard_url}', dashboardUrl);
  rep('{batas_waspada}', fmtCm(event.threshold_waspada_cm));
  rep('{batas_siaga}', fmtCm(event.threshold_siaga_cm));
  rep('{batas_bahaya}', fmtCm(event.threshold_bahaya_cm));
  rep('{interval}', String(intervalMin));
  rep('{selisih}', String(selisih));
  rep('{kontak_petugas}', dash(event.contact_petugas));
  rep('{no_bpbd}', dash(event.contact_bpbd));
  rep('{no_posko}', dash(event.contact_posko));

  return text;
}

/** Default satu baris jika tidak ada template DB. */
export function defaultWaMessageBody(event: NotificationEvent, dashboardUrl: string): string {
  const waktu = formatWaktuWib(event.recorded_at);
  const statusLabel = WA_STATUS_LABEL[event.water_status] ?? event.water_status;
  const levelM = (event.water_level_cm / 100).toFixed(2);
  const lines = [
    '*SiJagaAir* — Peringatan TMA',
    '',
    `📍 Lokasi: *${event.location_name}*`,
    `⚠️ Status: *${statusLabel}*`,
    `📏 Ketinggian air: *${fmtCm(event.water_level_cm)} cm* (≈ ${levelM} m)`,
    `🕐 Waktu (WIB): ${waktu}`,
    '',
    `🔗 Pantau detail: ${dashboardUrl}`,
  ];
  return lines.join('\n');
}

/**
 * Format pesan WA final: pilih template per status, fallback legacy / default.
 */
export function formatWaMessage(
  event: NotificationEvent,
  deploymentRow: Partial<DeploymentWaRow> | null | undefined,
  dashboardUrl: string
): string {
  let picked = pickWaTemplateString(event.water_status, deploymentRow ?? null);
  if (!picked?.trim()) {
    picked = BUILTIN_WA_TEMPLATE_BY_STATUS[event.water_status];
  }
  if (picked?.trim()) {
    return applyWaPlaceholders(picked, event, dashboardUrl);
  }
  return defaultWaMessageBody(event, dashboardUrl);
}

/** `selisih_cm` = cm di atas ambang waspada (untuk teks waspada). */
export function computeSelisihCmAboveWaspada(levelCm: number, thresholdWaspada: number): number {
  return Math.max(0, levelCm - thresholdWaspada);
}

/** Event sintetis untuk preview / send-test (tanpa CCTV path). */
export function buildSyntheticNotificationEvent(
  input: Omit<NotificationEvent, 'reading_id' | 'recorded_at' | 'cctv_image_path' | 'selisih_cm'>,
  opts?: { readingIdPrefix?: string }
): NotificationEvent {
  const prefix = opts?.readingIdPrefix ?? 'synthetic';
  return {
    ...input,
    reading_id: `${prefix}-${Date.now()}`,
    recorded_at: new Date().toISOString(),
    cctv_image_path: null,
    selisih_cm: computeSelisihCmAboveWaspada(input.water_level_cm, input.threshold_waspada_cm),
  };
}

