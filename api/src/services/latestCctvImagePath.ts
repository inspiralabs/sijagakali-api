import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Foto CCTV terbaru device untuk Test Notifikasi.
 * device_configs.last_snapshot_path diisi setiap snapshot (manual, berkala, alarm) → sumber utama;
 * sensor_readings.cctv_image_path hanya untuk data lama sebelum kolom itu ada.
 */
export async function latestCctvImagePath(
  supabase: SupabaseClient,
  slug: string,
  deviceId: string
): Promise<string | null> {
  const { data: cfg } = await supabase
    .from('device_configs')
    .select('last_snapshot_path')
    .eq('deployment_slug', slug)
    .eq('device_id', deviceId)
    .maybeSingle();
  if (cfg?.last_snapshot_path) return cfg.last_snapshot_path as string;

  const { data: reading } = await supabase
    .from('sensor_readings')
    .select('cctv_image_path')
    .eq('deployment_slug', slug)
    .eq('device_id', deviceId)
    .not('cctv_image_path', 'is', null)
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (reading?.cctv_image_path as string | undefined) ?? null;
}
