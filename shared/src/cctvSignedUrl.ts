import type { SupabaseClient } from '@supabase/supabase-js';

/** Segmen folder `YYYY-MM-DD` di path Storage — sering salah tahun (DB vs folder unggahan). */
function shiftFirstDateFolderYear(key: string, deltaYears: number): string | null {
  const m = key.match(/\/(\d{4})(-\d{2}-\d{2})\//);
  if (!m || m.index === undefined) return null;
  const y = parseInt(m[1], 10);
  const ny = y + deltaYears;
  if (ny < 1990 || ny > 2120) return null;
  const full = m[0];
  return key.slice(0, m.index) + `/${ny}${m[2]}/` + key.slice(m.index + full.length);
}

/** Kandidat key Storage untuk satu path DB (unggahan manual sering beda prefix/folder). */
export function buildCctvStorageKeyCandidates(storagePath: string, deviceId: string): string[] {
  const trimmed = storagePath.trim();
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (k: string) => {
    const t = k.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  add(trimmed);
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length >= 2) {
    add(parts.slice(1).join('/'));
  }
  const base = parts.length ? parts[parts.length - 1] : trimmed;
  if (base && deviceId) {
    const dm = base.match(/^(\d{4})(\d{2})(\d{2})T/i);
    if (dm) {
      add(`${deviceId}/${dm[1]}-${dm[2]}-${dm[3]}/${base}`);
    }
    add(`${deviceId}/${base}`);
  }

  // Path DB bisa pakai folder tanggal beda satu tahun dari folder aktual di bucket (typo / seed).
  const snapshot = [...out];
  for (const key of snapshot) {
    for (const d of [-1, 1] as const) {
      const v = shiftFirstDateFolderYear(key, d);
      if (v) add(v);
    }
  }

  return out;
}

/** Signed URL pertama yang berhasil, atau null. */
export async function createCctvSignedUrlFlexible(
  storage: SupabaseClient<any, any, any, any, any>,
  bucket: string,
  storagePath: string,
  deviceId: string
): Promise<string | null> {
  for (const key of buildCctvStorageKeyCandidates(storagePath, deviceId)) {
    const { data, error } = await storage.storage.from(bucket).createSignedUrl(key, 3600);
    if (!error && data?.signedUrl) return data.signedUrl;
  }
  return null;
}
