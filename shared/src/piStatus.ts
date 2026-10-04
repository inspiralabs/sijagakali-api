/**
 * Laporan kondisi Raspberry Pi lokasi: topik `devices/<pi>/health` (retained), dikirim
 * `sjk-health-publish` di Pi tiap 5 menit (dikelola server-setup/field/pi).
 * `ts` = detik unix jam Pi; dipakai sebagai waktu suhu karena pesan retained dikirim ulang
 * setiap collector subscribe — jam server akan membuat suhu lama tampak baru.
 */
export function parsePiHealth(payload: unknown): { tempC: number; at: Date } | null {
  const p = payload as { temp_c?: unknown; ts?: unknown } | null;
  const t = p?.temp_c;
  const ts = p?.ts;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < -20 || t > 120) return null;
  if (typeof ts !== 'number' || !Number.isFinite(ts) || ts < 1_600_000_000) return null;
  return { tempC: Math.round(t * 10) / 10, at: new Date(ts * 1000) };
}

/** `"pi-a=node-1,pi-b=node-2"` → Map Pi → device_id. Entri rusak diabaikan. */
export function parsePiDeviceMap(spec: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const entry of spec.split(',')) {
    const parts = entry.trim().split('=');
    if (parts.length === 2 && parts[0] && parts[1]) map.set(parts[0].trim(), parts[1].trim());
  }
  return map;
}
