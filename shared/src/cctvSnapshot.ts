import { ENV } from './env.js';
import { getSupabase, getSupabaseStorage } from './supabaseClient.js';
import { fetchHikvisionSnapshot } from './hikvision.js';
import { cctvStoragePath } from './cctvSignedUrl.js';

/**
 * Ambil snapshot kamera → upload ke bucket CCTV.
 * Path Storage bila sukses; null bila gagal di langkah mana pun (tidak throw —
 * kamera mati tidak boleh menahan notifikasi).
 * channel: 101 = main stream (alarm/manual, foto tajam untuk WA), 102 = sub stream (berkala, kecil).
 */
export async function captureSnapshot(opts: {
  host: string;
  deploymentSlug: string;
  deviceId: string;
  channel?: number;
}): Promise<string | null> {
  try {
    const jpeg = await fetchHikvisionSnapshot(opts.host, {
      username: ENV.CCTV_USERNAME,
      password: ENV.CCTV_PASSWORD,
      timeoutMs: ENV.CCTV_SNAPSHOT_TIMEOUT_MS,
      channel: opts.channel,
    });
    const path = cctvStoragePath(opts.deploymentSlug, opts.deviceId);
    // upsert: dua snapshot device yang sama dalam detik yang sama berbagi path; timpa, jangan gagal.
    const { error } = await getSupabaseStorage()
      .storage.from(ENV.SUPABASE_STORAGE_BUCKET_CCTV_IMAGES)
      .upload(path, jpeg, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(`upload Storage: ${error.message}`);
    // Satu sumber "foto terbaru" untuk dashboard + jam terakhir snapshot (dasar jadwal berkala).
    const { error: cfgErr } = await getSupabase()
      .from('device_configs')
      .update({ last_snapshot_path: path, last_snapshot_at: new Date().toISOString() })
      .eq('deployment_slug', opts.deploymentSlug)
      .eq('device_id', opts.deviceId);
    if (cfgErr) console.error('[cctv_snapshot] UPDATE device_configs.last_snapshot gagal:', cfgErr.message);
    return path;
  } catch (err) {
    console.error(
      `[cctv_snapshot_failed] device=${opts.deviceId} host=${opts.host}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
