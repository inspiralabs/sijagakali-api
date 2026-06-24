const WIB_TZ = 'Asia/Jakarta';

/** Malam: 18:00–05:59 WIB */
export function parseBmkgDatetime(dtStr: string | undefined): Date | null {
  if (!dtStr) return null;
  const normalized = dtStr.replace(' ', 'T');
  const d = new Date(`${normalized}${normalized.includes('+') ? '' : '+07:00'}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getWibHour(d: Date): number {
  return Number(
    d.toLocaleString('en-US', { timeZone: WIB_TZ, hour: 'numeric', hour12: false })
  );
}

export function isNightTimeWib(localDatetime: string): boolean {
  const d = parseBmkgDatetime(localDatetime);
  if (!d) return false;
  const hour = getWibHour(d);
  return hour >= 18 || hour < 6;
}

/** Kode cuaca langit cerah/berawan — ikon & teks disesuaikan saat malam */
const NIGHT_SKY_CODES = new Set([0, 1, 2, 3, 4]);

const NIGHT_WEATHER_DESC: Record<number, string> = {
  0: 'Malam Cerah',
  1: 'Malam Cerah Berawan',
  2: 'Berawan Malam',
  3: 'Berawan Tebal Malam',
  4: 'Mendung Malam',
};

export function adjustWeatherDescForNight(
  weatherCode: number | null,
  weatherDesc: string,
  localDatetime: string
): string {
  if (weatherCode == null || !localDatetime || !isNightTimeWib(localDatetime)) {
    return weatherDesc;
  }
  if (!NIGHT_SKY_CODES.has(weatherCode)) return weatherDesc;
  return NIGHT_WEATHER_DESC[weatherCode] ?? weatherDesc;
}
