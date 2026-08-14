import {
  formatWaMessage,
  buildSyntheticNotificationEvent,
  type DeploymentWaRow,
  type NotificationEvent,
} from '@sijagakali/shared';

export const DEPLOYMENT_WA_COLUMNS =
  'display_name,whatsapp_message_template,wa_template_normal,wa_template_waspada,wa_template_siaga,wa_template_bahaya,contact_petugas,contact_bpbd,contact_posko';

export type SkipImageReason = 'unchecked' | 'no_path' | 'signed_url_failed' | 'image_download_failed';

export function parseWaterStatus(raw: string): NotificationEvent['water_status'] | null {
  const s = String(raw).toLowerCase();
  if (s === 'normal' || s === 'waspada' || s === 'siaga' || s === 'bahaya') return s;
  return null;
}

export function buildTestPreview(
  event: NotificationEvent,
  deploymentRow: Partial<DeploymentWaRow> | null,
  dashboardUrl: string
): string {
  const text = formatWaMessage(event, deploymentRow, dashboardUrl);
  return `[TEST]\n${text}`;
}

export function buildTestEventFromDeviceAndDeployment(opts: {
  slug: string;
  device_id: string;
  location_name: string;
  water_level_cm: number;
  water_status: NotificationEvent['water_status'];
  read_interval_sec: number;
  threshold_waspada_cm: number;
  threshold_siaga_cm: number;
  threshold_bahaya_cm: number;
  deploymentRow: Partial<DeploymentWaRow> | null;
}): NotificationEvent {
  const { deploymentRow, slug, ...rest } = opts;
  return buildSyntheticNotificationEvent(
    {
      deployment_slug: slug,
      device_id: rest.device_id,
      location_name: rest.location_name,
      water_level_cm: rest.water_level_cm,
      water_status: rest.water_status,
      deployment_display_name: deploymentRow?.display_name ?? slug,
      read_interval_sec: rest.read_interval_sec,
      threshold_waspada_cm: rest.threshold_waspada_cm,
      threshold_siaga_cm: rest.threshold_siaga_cm,
      threshold_bahaya_cm: rest.threshold_bahaya_cm,
      contact_petugas: deploymentRow?.contact_petugas ?? null,
      contact_bpbd: deploymentRow?.contact_bpbd ?? null,
      contact_posko: deploymentRow?.contact_posko ?? null,
    },
    { readingIdPrefix: 'preview' }
  );
}
