import type {
  BmkgForecastCurrent,
  BmkgForecastDay,
  BmkgForecastHour,
  BmkgNormalizedForecast,
} from './types.js';

const BMKG_FORECAST_URL = 'https://api.bmkg.go.id/publik/prakiraan-cuaca';

export const BMKG_ADM4_RE = /^\d{2}\.\d{2}\.\d{2}\.\d{4}$/;

const CACHE_TTL_MS = 15 * 60_000;

type CacheEntry<T> = { value: T; expiresAt: number };

const forecastCache = new Map<string, CacheEntry<BmkgNormalizedForecast>>();

function parseBmkgDatetime(dtStr: string | undefined): Date | null {
  if (!dtStr) return null;
  const normalized = dtStr.replace(' ', 'T');
  const d = new Date(`${normalized}+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatLocalTime(dtStr: string): string {
  const d = parseBmkgDatetime(dtStr);
  if (!d) return '';
  return d.toLocaleTimeString('id-ID', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jakarta',
  });
}

function formatDateLabel(dtStr: string): string {
  const d = parseBmkgDatetime(dtStr);
  if (!d) return '';
  const hari = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const bln = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  const wib = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return `${hari[wib.getDay()]}, ${wib.getDate()} ${bln[wib.getMonth()]}`;
}

function dayLabel(idx: number): string {
  if (idx === 0) return 'Hari ini';
  if (idx === 1) return 'Besok';
  return 'Lusa';
}

type RawHour = {
  local_datetime?: string;
  utc_datetime?: string;
  t?: number | string;
  weather?: number | string;
  weather_desc?: string;
  hu?: number | string;
  ws?: number | string;
  wd?: string;
  vs_text?: string;
};

function mapHour(jam: RawHour): BmkgForecastHour {
  return {
    localDatetime: jam.local_datetime ?? jam.utc_datetime ?? '',
    temperatureC: jam.t != null ? Number(jam.t) : null,
    weatherCode: jam.weather != null ? Number(jam.weather) : null,
    weatherDesc: jam.weather_desc ?? '',
    humidityPct: jam.hu != null ? Number(jam.hu) : null,
    windSpeedKmh: jam.ws != null ? Number(jam.ws) : null,
    windDir: jam.wd ?? '',
    visibilityText: jam.vs_text ?? '',
  };
}

function findNearestHour(allHours: BmkgForecastHour[]): BmkgForecastHour | null {
  const now = Date.now();
  let nearest: BmkgForecastHour | null = null;
  let nearestDiff = Infinity;
  for (const h of allHours) {
    const dt = parseBmkgDatetime(h.localDatetime);
    if (!dt) continue;
    const diff = Math.abs(dt.getTime() - now);
    if (diff < nearestDiff) {
      nearestDiff = diff;
      nearest = h;
    }
  }
  return nearest;
}

function normalizeForecast(adm4: string, raw: Record<string, unknown>): BmkgNormalizedForecast {
  const lokasi = (raw.lokasi ?? {}) as Record<string, string>;
  const dataArr = Array.isArray(raw.data) ? raw.data : [];
  const first = (dataArr[0] ?? {}) as { cuaca?: RawHour[][] };
  const cuacaAll: RawHour[][] = Array.isArray(first.cuaca) ? first.cuaca : [];

  const days: BmkgForecastDay[] = [];
  const flatHours: BmkgForecastHour[] = [];

  cuacaAll.forEach((hari, idx) => {
    if (!hari?.length) return;
    const hours = hari.slice(0, 8).map(mapHour);
    flatHours.push(...hours);
    days.push({
      label: dayLabel(idx),
      dateLabel: formatDateLabel(hari[0]?.local_datetime ?? ''),
      hours,
    });
  });

  const nearest = findNearestHour(flatHours);
  const current: BmkgForecastCurrent | null = nearest
    ? {
        temperatureC: nearest.temperatureC,
        weatherCode: nearest.weatherCode,
        weatherDesc: nearest.weatherDesc,
        humidityPct: nearest.humidityPct,
        windSpeedKmh: nearest.windSpeedKmh,
        windDir: nearest.windDir,
        visibilityText: nearest.visibilityText,
        updatedAt: nearest.localDatetime,
      }
    : null;

  return {
    adm4,
    location: {
      desa: lokasi.desa ?? '',
      kecamatan: lokasi.kecamatan ?? '',
      kotkab: lokasi.kotkab ?? '',
      provinsi: lokasi.provinsi ?? '',
    },
    current,
    days,
    source: 'bmkg',
    fetchedAt: new Date().toISOString(),
  };
}

async function fetchBmkgForecastRaw(adm4: string): Promise<BmkgNormalizedForecast> {
  const url = `${BMKG_FORECAST_URL}?adm4=${encodeURIComponent(adm4)}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`BMKG forecast HTTP ${res.status}`);
  const json = (await res.json()) as Record<string, unknown>;
  if (!json.data && !json.lokasi) {
    throw new Error('Data BMKG tidak valid atau kode ADM4 tidak ditemukan');
  }
  return normalizeForecast(adm4, json);
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCache<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T): void {
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export async function getForecast(adm4: string): Promise<BmkgNormalizedForecast> {
  if (!BMKG_ADM4_RE.test(adm4)) {
    throw new Error('Format kode ADM4 tidak valid');
  }
  const cached = getCached(forecastCache, adm4);
  if (cached) return cached;
  const data = await fetchBmkgForecastRaw(adm4);
  setCache(forecastCache, adm4, data);
  return data;
}

export function formatForecastTime(dtStr: string): string {
  return formatLocalTime(dtStr);
}

export function clearBmkgCache(): void {
  forecastCache.clear();
}
