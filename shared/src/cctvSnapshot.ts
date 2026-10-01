import { ENV } from './env.js';
import { getSupabaseStorage } from './supabaseClient.js';
import { fetchHikvisionSnapshot } from './hikvision.js';
import { cctvStoragePath } from './cctvSignedUrl.js';

/**
 * Ambil snapshot kamera → upload ke bucket CCTV.
 * Path Storage bila sukses; null bila gagal di langkah mana pun (tidak throw —
 * kamera mati tidak boleh menahan notifikasi).
 */
export async function captureSnapshot(opts: {
  host: string;
  deploymentSlug: string;
  deviceId: string;
}): Promise<string | null> {
  try {
    const jpeg = await fetchHikvisionSnapshot(opts.host, {
      username: ENV.CCTV_USERNAME,
      password: ENV.CCTV_PASSWORD,
      timeoutMs: ENV.CCTV_SNAPSHOT_TIMEOUT_MS,
    });
    const path = cctvStoragePath(opts.deploymentSlug, opts.deviceId);
    const { error } = await getSupabaseStorage()
      .storage.from(ENV.SUPABASE_STORAGE_BUCKET_CCTV_IMAGES)
      .upload(path, jpeg, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(`upload Storage: ${error.message}`);
    return path;
  } catch (err) {
    console.error(
      `[cctv_snapshot_failed] device=${opts.deviceId} host=${opts.host}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
