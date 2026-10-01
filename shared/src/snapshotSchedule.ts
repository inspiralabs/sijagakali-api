/**
 * Apakah snapshot berkala sudah jatuh tempo?
 * `lastAt` = ISO string (kolom DB) atau epoch ms; null/tidak valid → langsung tempo.
 * `intervalMin` ≤ 0 → snapshot berkala mati.
 */
export function isSnapshotDue(
  lastAt: string | number | null | undefined,
  intervalMin: number,
  now = Date.now()
): boolean {
  if (!(intervalMin > 0)) return false;
  if (lastAt == null) return true;
  const last = typeof lastAt === 'number' ? lastAt : Date.parse(lastAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= intervalMin * 60_000;
}
