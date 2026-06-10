import type { WeatherNotificationEvent } from '@sijagaair/shared';

type AlertKind = WeatherNotificationEvent['alert_type'];

interface CooldownState {
  lastNotifAt: number;
}

const state = new Map<string, CooldownState>();

function cooldownKey(
  deploymentSlug: string,
  deviceId: string,
  alertType: AlertKind
): string {
  return `${deploymentSlug}:${deviceId}:${alertType}`;
}

export function shouldNotifyWeather(
  deploymentSlug: string,
  deviceId: string,
  alertType: AlertKind,
  cooldownMs: number
): boolean {
  const key = cooldownKey(deploymentSlug, deviceId, alertType);
  const s = state.get(key);
  const now = Date.now();
  if (s && now - s.lastNotifAt < cooldownMs) return false;
  return true;
}

export function markWeatherNotified(
  deploymentSlug: string,
  deviceId: string,
  alertType: AlertKind
): void {
  const key = cooldownKey(deploymentSlug, deviceId, alertType);
  state.set(key, { lastNotifAt: Date.now() });
}
