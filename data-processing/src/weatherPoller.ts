import {
  getSupabase,
  ENV,
  notifEmitter,
  getForecast,
  getNowcastAlerts,
  filterNowcastByKeywords,
  findUpcomingExtreme,
  type WeatherNotificationEvent,
} from '@sijagaair/shared';
import { shouldNotifyWeather, markWeatherNotified } from './weatherPolicy.js';

const supabase = getSupabase();

type DeviceWeatherConfig = {
  deployment_slug: string;
  device_id: string;
  location_name: string;
  bmkg_adm4: string;
  bmkg_nowcast_keywords: string[] | null;
};

type DeploymentRow = {
  slug: string;
  display_name: string;
  contact_petugas: string | null;
  contact_bpbd: string | null;
  contact_posko: string | null;
};

async function loadWeatherDevices(): Promise<DeviceWeatherConfig[]> {
  const { data, error } = await supabase
    .from('device_configs')
    .select('deployment_slug, device_id, location_name, bmkg_adm4, bmkg_nowcast_keywords')
    .eq('is_active', true)
    .not('bmkg_adm4', 'is', null);

  if (error) {
    console.error('[weather-poller] load devices error:', error.message);
    return [];
  }
  return (data ?? []) as DeviceWeatherConfig[];
}

async function getDeployment(slug: string): Promise<DeploymentRow | null> {
  const { data, error } = await supabase
    .from('deployments')
    .select('slug, display_name, contact_petugas, contact_bpbd, contact_posko')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) return null;
  return data as DeploymentRow;
}

function emitWeather(event: WeatherNotificationEvent, alertType: WeatherNotificationEvent['alert_type']) {
  if (
    !shouldNotifyWeather(
      event.deployment_slug,
      event.device_id,
      alertType,
      ENV.WEATHER_NOTIFY_COOLDOWN_MS
    )
  ) {
    return;
  }
  notifEmitter.emit('weather-notify', event);
  markWeatherNotified(event.deployment_slug, event.device_id, alertType);
  console.log(
    `[weather-poller] weather-notify emitted device=${event.device_id} type=${alertType}`
  );
}

export async function runWeatherPoll(): Promise<void> {
  const devices = await loadWeatherDevices();
  if (!devices.length) return;

  let allNowcast: Awaited<ReturnType<typeof getNowcastAlerts>> = [];
  try {
    allNowcast = await getNowcastAlerts();
  } catch (e) {
    console.error('[weather-poller] nowcast fetch failed:', e instanceof Error ? e.message : e);
  }

  const forecastByAdm4 = new Map<string, Awaited<ReturnType<typeof getForecast>>>();

  for (const device of devices) {
    const adm4 = device.bmkg_adm4;
    if (!adm4) continue;

    const dep = await getDeployment(device.deployment_slug);
    const base: Omit<WeatherNotificationEvent, 'alert_type' | 'weather_desc' | 'temperature_c' | 'alert_title' | 'alert_description' | 'recorded_at'> = {
      deployment_slug: device.deployment_slug,
      device_id: device.device_id,
      location_name: device.location_name,
      deployment_display_name: dep?.display_name ?? device.deployment_slug,
      contact_petugas: dep?.contact_petugas ?? null,
      contact_bpbd: dep?.contact_bpbd ?? null,
      contact_posko: dep?.contact_posko ?? null,
    };

    const keywords = device.bmkg_nowcast_keywords ?? [];
    const relevantNowcast = filterNowcastByKeywords(allNowcast, keywords);

    if (relevantNowcast.length > 0) {
      const alert = relevantNowcast[0]!;
      emitWeather(
        {
          ...base,
          alert_type: 'nowcast',
          weather_desc: alert.title,
          temperature_c: null,
          alert_title: alert.title,
          alert_description: alert.description,
          recorded_at: new Date().toISOString(),
        },
        'nowcast'
      );
    }

    try {
      let forecast = forecastByAdm4.get(adm4);
      if (!forecast) {
        forecast = await getForecast(adm4);
        forecastByAdm4.set(adm4, forecast);
      }

      const extreme = findUpcomingExtreme(forecast, 3);
      if (extreme) {
        emitWeather(
          {
            ...base,
            alert_type: 'heavy_rain',
            weather_desc: extreme.hour.weatherDesc,
            temperature_c: extreme.hour.temperatureC,
            alert_title: `Prakiraan ${extreme.hour.weatherDesc}`,
            alert_description: `Cuaca ekstrem diprakirakan dalam ~${Math.ceil(extreme.hoursAhead)} jam.`,
            recorded_at: new Date().toISOString(),
          },
          'heavy_rain'
        );
      }
    } catch (e) {
      console.error(
        `[weather-poller] forecast failed for ${device.device_id}:`,
        e instanceof Error ? e.message : e
      );
    }
  }
}

export function startWeatherPoller(): void {
  const interval = ENV.WEATHER_POLL_INTERVAL_MS;
  console.log(`[weather-poller] started (interval=${interval}ms)`);
  void runWeatherPoll();
  setInterval(() => {
    void runWeatherPoll();
  }, interval);
}
