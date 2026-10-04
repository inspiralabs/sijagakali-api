/** Suhu CPU Raspberry Pi dari payload `cctv/pi-status`; null bila bukan angka −20…120 °C. */
export function parsePiTemp(payload: unknown): number | null {
  const t = (payload as { pi_temp_c?: unknown } | null)?.pi_temp_c;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < -20 || t > 120) return null;
  return Math.round(t * 10) / 10;
}
