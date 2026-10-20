import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export type Row = Record<string, unknown>;
/** Bentuk hasil insert supabase-js. Throw (mis. jaringan putus) juga dianggap gagal. */
export type InsertFn = (row: Row) => PromiseLike<{ error: { code?: string; message: string } | null }>;

// correlation_id yang sama sudah tersimpan (kiriman ulang device / isi spool yang sudah masuk):
// unique index uq_mqtt_ingestion_deploy_corr_type menolaknya — data aman, bukan gagal.
const UNIQUE_VIOLATION = '23505';

/** null = tersimpan, selain itu pesan error. */
async function insertOnce(insert: InsertFn, row: Row): Promise<string | null> {
  try {
    const { error } = await insert(row);
    return !error || error.code === UNIQUE_VIOLATION ? null : error.message;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

/**
 * Simpan satu baris ke DB; gagal → coba ulang setelah tiap jeda, lalu tulis ke file spool.
 * 'db' / 'spool' = data aman, boleh di-PUBACK. 'failed' = jangan PUBACK, biar broker kirim ulang.
 */
export async function saveDurably(
  insert: InsertFn,
  row: Row,
  spoolFile: string,
  retryDelaysMs: number[] = [1000, 3000]
): Promise<'db' | 'spool' | 'failed'> {
  let error = await insertOnce(insert, row);
  for (const ms of retryDelaysMs) {
    if (error === null) break;
    await new Promise((r) => setTimeout(r, ms));
    error = await insertOnce(insert, row);
  }
  if (error === null) return 'db';

  console.error(`[collector] INSERT gagal ${retryDelaysMs.length + 1}x (${error}) — disimpan ke spool`);
  try {
    await mkdir(dirname(spoolFile), { recursive: true });
    await appendFile(spoolFile, JSON.stringify(row) + '\n');
    return 'spool';
  } catch (err) {
    console.error('[collector] tulis spool gagal:', err instanceof Error ? err.message : String(err));
    return 'failed';
  }
}

/**
 * Masukkan ulang isi spool ke DB, berurutan. Berhenti di kegagalan pertama (DB masih bermasalah);
 * sisanya dikembalikan ke spool. @returns jumlah baris yang tersimpan.
 */
export async function flushSpool(insert: InsertFn, spoolFile: string): Promise<number> {
  const work = `${spoolFile}.flushing`;
  // .flushing tersisa = flush sebelumnya terputus (restart); proses itu dulu. Baris yang ternyata
  // sudah masuk ditolak unique index dan dihitung tersimpan.
  if (!existsSync(work)) {
    if (!existsSync(spoolFile)) return 0;
    await rename(spoolFile, work);
  }

  const lines = (await readFile(work, 'utf8')).split('\n').filter(Boolean);
  let saved = 0;
  let i = 0;
  for (; i < lines.length; i++) {
    let row: Row;
    try {
      row = JSON.parse(lines[i]!) as Row;
    } catch {
      console.error('[collector] baris spool rusak dibuang:', lines[i]!.slice(0, 120));
      continue;
    }
    if ((await insertOnce(insert, row)) !== null) break;
    saved++;
  }

  const rest = lines.slice(i);
  if (rest.length) await appendFile(spoolFile, rest.join('\n') + '\n');
  await rm(work);
  return saved;
}
