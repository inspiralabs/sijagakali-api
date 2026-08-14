import type { FastifyInstance } from 'fastify';
import { createMqttClient, ENV } from '@sijagakali/shared';
import type { RouteDeps } from '../types/deps.js';

const MAX_COOLDOWN_SEC = 604_800; // 7 hari

function parseNotifyDigestHours(raw: unknown): { ok: true; value: number[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: 'notify_digest_hours_local harus array angka jam 0–23' };
  const hours: number[] = [];
  for (const x of raw) {
    const n = typeof x === 'number' ? x : Number(x);
    if (!Number.isInteger(n) || n < 0 || n > 23) {
      return { ok: false, error: 'Setiap jam digest harus bilangan bulat 0–23' };
    }
    hours.push(n);
  }
  const uniq = [...new Set(hours)].sort((a, b) => a - b);
  if (uniq.length < 1) return { ok: false, error: 'notify_digest_hours_local minimal satu jam' };
  return { ok: true, value: uniq };
}

function optionalNonnegInt(
  v: unknown,
  field: string,
  max: number
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, value: undefined };
  if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isInteger(v)) {
    return { ok: false, error: `${field} harus bilangan bulat` };
  }
  if (v < 0 || v > max) return { ok: false, error: `${field} di luar rentang yang diizinkan` };
  return { ok: true, value: v };
}

function optionalNonnegNumber(
  v: unknown,
  field: string,
  max: number
): { ok: true; value: number | undefined } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, value: undefined };
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    return { ok: false, error: `${field} harus angka` };
  }
  if (v < 0 || v > max) return { ok: false, error: `${field} di luar rentang yang diizinkan` };
  return { ok: true, value: v };
}

const DEVICE_ID_RE = /^[a-zA-Z0-9._-]{1,120}$/;

function validateThresholdTriple(w: number, s: number, b: number): string | null {
  if (!Number.isFinite(w) || !Number.isFinite(s) || !Number.isFinite(b)) {
    return 'Ambang waspada, siaga, dan bahaya harus angka valid';
  }
  if (!(w < s && s < b)) return 'Ambang harus memenuhi: waspada < siaga < bahaya';
  return null;
}

export async function registerDeviceRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, requireAdmin } = deps;

  app.post<{
    Params: { deviceId: string };
    Body: { deployment_slug?: string; interval_sec: number };
  }>('/api/device/:deviceId/interval', { preHandler: requireAdmin }, async (req, reply) => {
    const { deviceId } = req.params;
    const { deployment_slug, interval_sec } = req.body;

    if (!interval_sec || typeof interval_sec !== 'number' || interval_sec < 10) {
      return reply.code(400).send({ error: 'interval_sec must be >= 10' });
    }

    const slug = deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;

    const { error } = await supabase
      .from('device_configs')
      .update({ read_interval_sec: interval_sec, updated_at: new Date().toISOString() })
      .eq('deployment_slug', slug)
      .eq('device_id', deviceId);

    if (error) {
      req.log.error({ msg: 'UPDATE device_configs error', error: error.message });
      return reply.code(500).send({ error: error.message });
    }

    try {
      const mqttClient = createMqttClient('api-interval');
      await new Promise<void>((resolve, reject) => {
        mqttClient.on('connect', () => {
          const topic = `sijagakali/${deviceId}/config/interval`;
          const payload = JSON.stringify({ interval_sec, updated_by: 'admin-dashboard' });
          mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
            mqttClient.end();
            if (err) reject(err);
            else resolve();
          });
        });
        mqttClient.on('error', reject);
        setTimeout(() => reject(new Error('MQTT connect timeout')), 5000);
      });
    } catch (mqttErr) {
      const msg = mqttErr instanceof Error ? mqttErr.message : String(mqttErr);
      req.log.warn({ msg: 'MQTT publish failed (DB updated)', mqttErr: msg });
      return reply.send({ ok: true, mqttWarning: msg });
    }

    return reply.send({ ok: true });
  });

  app.post<{
    Params: { deviceId: string };
    Body: {
      deployment_slug?: string;
      location_name?: string;
      display_name?: string | null;
      sensor_height_cm?: number;
      mac_address?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      cctv_local_ip?: string | null;
      stream_playback_url?: string | null;
      threshold_waspada_cm?: number;
      threshold_siaga_cm?: number;
      threshold_bahaya_cm?: number;
      read_interval_sec?: number;
      notify_cooldown_waspada_sec?: number;
      notify_cooldown_siaga_sec?: number;
      notify_cooldown_bahaya_sec?: number;
      notify_surge_delta_cm?: number;
      notify_surge_window_min?: number;
      notify_digest_hours_local?: number[];
    };
  }>('/api/device/:deviceId/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const { deviceId } = req.params;
    const {
      deployment_slug,
      location_name,
      display_name,
      sensor_height_cm,
      mac_address,
      latitude,
      longitude,
      cctv_local_ip,
      stream_playback_url,
      threshold_waspada_cm,
      threshold_siaga_cm,
      threshold_bahaya_cm,
      read_interval_sec,
      notify_cooldown_waspada_sec,
      notify_cooldown_siaga_sec,
      notify_cooldown_bahaya_sec,
      notify_surge_delta_cm,
      notify_surge_window_min,
      notify_digest_hours_local,
    } = req.body;

    const slug = deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;

    const cw = optionalNonnegInt(notify_cooldown_waspada_sec, 'notify_cooldown_waspada_sec', MAX_COOLDOWN_SEC);
    if (!cw.ok) return reply.code(400).send({ error: cw.error });
    const cs = optionalNonnegInt(notify_cooldown_siaga_sec, 'notify_cooldown_siaga_sec', MAX_COOLDOWN_SEC);
    if (!cs.ok) return reply.code(400).send({ error: cs.error });
    const cb = optionalNonnegInt(notify_cooldown_bahaya_sec, 'notify_cooldown_bahaya_sec', MAX_COOLDOWN_SEC);
    if (!cb.ok) return reply.code(400).send({ error: cb.error });
    const sd = optionalNonnegNumber(notify_surge_delta_cm, 'notify_surge_delta_cm', 5000);
    if (!sd.ok) return reply.code(400).send({ error: sd.error });
    const sw = optionalNonnegInt(notify_surge_window_min, 'notify_surge_window_min', 10_080);
    if (!sw.ok) return reply.code(400).send({ error: sw.error });
    if (sw.value !== undefined && sw.value < 1) {
      return reply.code(400).send({ error: 'notify_surge_window_min minimal 1 menit' });
    }

    let digestParsed: { ok: true; value: number[] } | { ok: false; error: string } | null = null;
    if (notify_digest_hours_local !== undefined) {
      digestParsed = parseNotifyDigestHours(notify_digest_hours_local);
      if (!digestParsed.ok) return reply.code(400).send({ error: digestParsed.error });
    }

    const { data: current, error: fetchErr } = await supabase
      .from('device_configs')
      .select(
        'threshold_waspada_cm, threshold_siaga_cm, threshold_bahaya_cm, read_interval_sec',
      )
      .eq('deployment_slug', slug)
      .eq('device_id', deviceId)
      .maybeSingle();

    if (fetchErr) {
      req.log.error({ msg: 'fetch device_configs error', error: fetchErr.message });
      return reply.code(500).send({ error: fetchErr.message });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (location_name !== undefined) updates.location_name = location_name;
    if (display_name !== undefined) {
      updates.display_name =
        display_name === null || display_name === ''
          ? null
          : String(display_name).trim() || null;
    }
    if (sensor_height_cm !== undefined) {
      if (
        typeof sensor_height_cm !== 'number' ||
        !Number.isFinite(sensor_height_cm) ||
        sensor_height_cm <= 0 ||
        sensor_height_cm > 50_000
      ) {
        return reply.code(400).send({ error: 'sensor_height_cm harus angka positif (maks 50000)' });
      }
      updates.sensor_height_cm = sensor_height_cm;
    }
    if (mac_address !== undefined) {
      updates.mac_address =
        mac_address === null || mac_address === ''
          ? null
          : String(mac_address).trim() || null;
    }
    if (latitude !== undefined) {
      updates.latitude =
        latitude === null || latitude === undefined || !Number.isFinite(latitude) ? null : latitude;
    }
    if (longitude !== undefined) {
      updates.longitude =
        longitude === null || longitude === undefined || !Number.isFinite(longitude) ? null : longitude;
    }
    if (cctv_local_ip !== undefined) {
      updates.cctv_local_ip =
        cctv_local_ip === null || cctv_local_ip === ''
          ? null
          : String(cctv_local_ip).trim() || null;
    }
    if (stream_playback_url !== undefined) {
      updates.stream_playback_url =
        stream_playback_url === null || stream_playback_url === ''
          ? null
          : String(stream_playback_url).trim() || null;
    }
    if (threshold_waspada_cm !== undefined) updates.threshold_waspada_cm = threshold_waspada_cm;
    if (threshold_siaga_cm !== undefined) updates.threshold_siaga_cm = threshold_siaga_cm;
    if (threshold_bahaya_cm !== undefined) updates.threshold_bahaya_cm = threshold_bahaya_cm;
    if (read_interval_sec !== undefined) updates.read_interval_sec = read_interval_sec;
    if (cw.value !== undefined) updates.notify_cooldown_waspada_sec = cw.value;
    if (cs.value !== undefined) updates.notify_cooldown_siaga_sec = cs.value;
    if (cb.value !== undefined) updates.notify_cooldown_bahaya_sec = cb.value;
    if (sd.value !== undefined) updates.notify_surge_delta_cm = sd.value;
    if (sw.value !== undefined) updates.notify_surge_window_min = sw.value;
    if (notify_digest_hours_local !== undefined && digestParsed && digestParsed.ok) {
      updates.notify_digest_hours_local = digestParsed.value;
    }

    const { error: updateErr } = await supabase
      .from('device_configs')
      .update(updates)
      .eq('deployment_slug', slug)
      .eq('device_id', deviceId);

    if (updateErr) {
      req.log.error({ msg: 'UPDATE device_configs settings error', error: updateErr.message });
      return reply.code(500).send({ error: updateErr.message });
    }

    const thresholdChanged =
      (threshold_waspada_cm !== undefined &&
        threshold_waspada_cm !== current?.threshold_waspada_cm) ||
      (threshold_siaga_cm !== undefined && threshold_siaga_cm !== current?.threshold_siaga_cm) ||
      (threshold_bahaya_cm !== undefined && threshold_bahaya_cm !== current?.threshold_bahaya_cm);

    if (thresholdChanged && current) {
      const { error: histErr } = await supabase.from('threshold_history').insert({
        deployment_slug: slug,
        device_id: deviceId,
        changed_by: 'admin-dashboard',
        old_values: {
          threshold_waspada_cm: current.threshold_waspada_cm,
          threshold_siaga_cm: current.threshold_siaga_cm,
          threshold_bahaya_cm: current.threshold_bahaya_cm,
        },
        new_values: {
          threshold_waspada_cm: threshold_waspada_cm ?? current.threshold_waspada_cm,
          threshold_siaga_cm: threshold_siaga_cm ?? current.threshold_siaga_cm,
          threshold_bahaya_cm: threshold_bahaya_cm ?? current.threshold_bahaya_cm,
        },
      });
      if (histErr) {
        req.log.warn({ msg: 'INSERT threshold_history gagal', error: histErr.message });
      }
    }

    if (read_interval_sec !== undefined && read_interval_sec !== current?.read_interval_sec) {
      try {
        const mqttClient = createMqttClient('api-settings');
        await new Promise<void>((resolve, reject) => {
          mqttClient.on('connect', () => {
            const topic = `sijagakali/${deviceId}/config/interval`;
            const payload = JSON.stringify({
              interval_sec: read_interval_sec,
              updated_by: 'admin-dashboard',
            });
            mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
              mqttClient.end();
              if (err) reject(err);
              else resolve();
            });
          });
          mqttClient.on('error', reject);
          setTimeout(() => reject(new Error('MQTT connect timeout')), 5000);
        });
      } catch (mqttErr) {
        const msg = mqttErr instanceof Error ? mqttErr.message : String(mqttErr);
        req.log.warn({ msg: 'MQTT publish failed after settings update', mqttErr: msg });
        return reply.send({ ok: true, mqttWarning: msg });
      }
    }

    return reply.send({ ok: true });
  });

  app.post<{
    Body: {
      deployment_slug?: string;
      device_id: string;
      location_name: string;
      display_name?: string | null;
      sensor_height_cm: number;
      read_interval_sec?: number;
      threshold_waspada_cm: number;
      threshold_siaga_cm: number;
      threshold_bahaya_cm: number;
      cctv_local_ip?: string | null;
      stream_playback_url?: string | null;
      mac_address?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    };
  }>('/api/device', { preHandler: requireAdmin }, async (req, reply) => {
    const slug = req.body.deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;
    const deviceId = typeof req.body.device_id === 'string' ? req.body.device_id.trim() : '';
    const locationName = typeof req.body.location_name === 'string' ? req.body.location_name.trim() : '';
    const sh = req.body.sensor_height_cm;
    const tw = req.body.threshold_waspada_cm;
    const ts = req.body.threshold_siaga_cm;
    const tb = req.body.threshold_bahaya_cm;
    const interval = req.body.read_interval_sec ?? 3600;

    if (!DEVICE_ID_RE.test(deviceId)) {
      return reply
        .code(400)
        .send({ error: 'device_id tidak valid (1–120 karakter: huruf, angka, titik, garis bawah, tanda hubung)' });
    }
    if (!locationName) return reply.code(400).send({ error: 'location_name wajib diisi' });
    if (typeof sh !== 'number' || !Number.isFinite(sh) || sh <= 0 || sh > 50_000) {
      return reply.code(400).send({ error: 'sensor_height_cm harus angka positif (maks 50000)' });
    }
    const thrErr = validateThresholdTriple(tw, ts, tb);
    if (thrErr) return reply.code(400).send({ error: thrErr });
    if (typeof interval !== 'number' || !Number.isInteger(interval) || interval < 10) {
      return reply.code(400).send({ error: 'read_interval_sec harus bilangan bulat >= 10' });
    }

    const displayNameRaw = req.body.display_name;
    const displayName =
      displayNameRaw === undefined || displayNameRaw === null
        ? null
        : String(displayNameRaw).trim() || null;

    const row = {
      deployment_slug: slug,
      device_id: deviceId,
      location_name: locationName,
      display_name: displayName,
      sensor_height_cm: sh,
      read_interval_sec: interval,
      threshold_waspada_cm: tw,
      threshold_siaga_cm: ts,
      threshold_bahaya_cm: tb,
      cctv_local_ip:
        req.body.cctv_local_ip === undefined || req.body.cctv_local_ip === null
          ? null
          : String(req.body.cctv_local_ip).trim() || null,
      stream_playback_url:
        req.body.stream_playback_url === undefined || req.body.stream_playback_url === null
          ? null
          : String(req.body.stream_playback_url).trim() || null,
      mac_address:
        typeof req.body.mac_address === 'string' && req.body.mac_address.trim().length
          ? req.body.mac_address.trim()
          : null,
      latitude: req.body.latitude != null && Number.isFinite(req.body.latitude) ? req.body.latitude : null,
      longitude: req.body.longitude != null && Number.isFinite(req.body.longitude) ? req.body.longitude : null,
      is_active: true,
    };

    const { error } = await supabase.from('device_configs').insert(row);
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return reply.code(409).send({ error: 'Perangkat dengan deployment_slug + device_id ini sudah ada' });
      }
      req.log.error({ msg: 'INSERT device_configs error', error: error.message });
      return reply.code(500).send({ error: error.message });
    }
    return reply.code(201).send({ ok: true, device_id: deviceId });
  });

  app.patch<{
    Params: { deviceId: string };
    Body: {
      deployment_slug?: string;
      location_name?: string;
      display_name?: string | null;
      sensor_height_cm?: number;
      read_interval_sec?: number;
      threshold_waspada_cm?: number;
      threshold_siaga_cm?: number;
      threshold_bahaya_cm?: number;
      cctv_local_ip?: string | null;
      stream_playback_url?: string | null;
      mac_address?: string | null;
      latitude?: number | null;
      longitude?: number | null;
    };
  }>('/api/device/:deviceId', { preHandler: requireAdmin }, async (req, reply) => {
    const { deviceId } = req.params;
    const slug = req.body.deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;
    const b = req.body;

    const { data: current, error: fetchErr } = await supabase
      .from('device_configs')
      .select(
        'threshold_waspada_cm, threshold_siaga_cm, threshold_bahaya_cm, read_interval_sec, location_name, sensor_height_cm, display_name',
      )
      .eq('deployment_slug', slug)
      .eq('device_id', deviceId)
      .maybeSingle();

    if (fetchErr) {
      req.log.error({ msg: 'fetch device_configs (patch) error', error: fetchErr.message });
      return reply.code(500).send({ error: fetchErr.message });
    }
    if (!current) return reply.code(404).send({ error: 'Perangkat tidak ditemukan' });

    const nextW = b.threshold_waspada_cm ?? current.threshold_waspada_cm;
    const nextS = b.threshold_siaga_cm ?? current.threshold_siaga_cm;
    const nextB = b.threshold_bahaya_cm ?? current.threshold_bahaya_cm;
    const thrErr = validateThresholdTriple(nextW, nextS, nextB);
    if (thrErr) return reply.code(400).send({ error: thrErr });

    if (b.sensor_height_cm !== undefined) {
      if (typeof b.sensor_height_cm !== 'number' || !Number.isFinite(b.sensor_height_cm) || b.sensor_height_cm <= 0 || b.sensor_height_cm > 50_000) {
        return reply.code(400).send({ error: 'sensor_height_cm harus angka positif (maks 50000)' });
      }
    }
    if (b.read_interval_sec !== undefined) {
      if (typeof b.read_interval_sec !== 'number' || !Number.isInteger(b.read_interval_sec) || b.read_interval_sec < 10) {
        return reply.code(400).send({ error: 'read_interval_sec harus bilangan bulat >= 10' });
      }
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (b.location_name !== undefined) updates.location_name = String(b.location_name).trim();
    if (b.display_name !== undefined) {
      updates.display_name =
        b.display_name === null || b.display_name === ''
          ? null
          : String(b.display_name).trim() || null;
    }
    if (b.sensor_height_cm !== undefined) updates.sensor_height_cm = b.sensor_height_cm;
    if (b.read_interval_sec !== undefined) updates.read_interval_sec = b.read_interval_sec;
    if (b.threshold_waspada_cm !== undefined) updates.threshold_waspada_cm = b.threshold_waspada_cm;
    if (b.threshold_siaga_cm !== undefined) updates.threshold_siaga_cm = b.threshold_siaga_cm;
    if (b.threshold_bahaya_cm !== undefined) updates.threshold_bahaya_cm = b.threshold_bahaya_cm;
    if (b.cctv_local_ip !== undefined) updates.cctv_local_ip = b.cctv_local_ip;
    if (b.stream_playback_url !== undefined) updates.stream_playback_url = b.stream_playback_url;
    if (b.mac_address !== undefined) {
      updates.mac_address = b.mac_address === null || b.mac_address === '' ? null : String(b.mac_address).trim();
    }
    if (b.latitude !== undefined) {
      updates.latitude = b.latitude === null || b.latitude === undefined || !Number.isFinite(b.latitude) ? null : b.latitude;
    }
    if (b.longitude !== undefined) {
      updates.longitude = b.longitude === null || b.longitude === undefined || !Number.isFinite(b.longitude) ? null : b.longitude;
    }

    const { error: updateErr } = await supabase
      .from('device_configs')
      .update(updates)
      .eq('deployment_slug', slug)
      .eq('device_id', deviceId);

    if (updateErr) {
      req.log.error({ msg: 'PATCH device_configs error', error: updateErr.message });
      return reply.code(500).send({ error: updateErr.message });
    }

    const thresholdChanged =
      (b.threshold_waspada_cm !== undefined && b.threshold_waspada_cm !== current.threshold_waspada_cm) ||
      (b.threshold_siaga_cm !== undefined && b.threshold_siaga_cm !== current.threshold_siaga_cm) ||
      (b.threshold_bahaya_cm !== undefined && b.threshold_bahaya_cm !== current.threshold_bahaya_cm);

    if (thresholdChanged) {
      const { error: histErr } = await supabase.from('threshold_history').insert({
        deployment_slug: slug,
        device_id: deviceId,
        changed_by: 'admin-dashboard',
        old_values: {
          threshold_waspada_cm: current.threshold_waspada_cm,
          threshold_siaga_cm: current.threshold_siaga_cm,
          threshold_bahaya_cm: current.threshold_bahaya_cm,
        },
        new_values: {
          threshold_waspada_cm: nextW,
          threshold_siaga_cm: nextS,
          threshold_bahaya_cm: nextB,
        },
      });
      if (histErr) {
        req.log.warn({ msg: 'INSERT threshold_history gagal (patch device)', error: histErr.message });
      }
    }

    const newInterval = b.read_interval_sec ?? current.read_interval_sec;
    if (b.read_interval_sec !== undefined && newInterval !== current.read_interval_sec) {
      try {
        const mqttClient = createMqttClient('api-device-patch');
        await new Promise<void>((resolve, reject) => {
          mqttClient.on('connect', () => {
            const topic = `sijagakali/${deviceId}/config/interval`;
            const payload = JSON.stringify({
              interval_sec: newInterval,
              updated_by: 'admin-dashboard',
            });
            mqttClient.publish(topic, payload, { qos: 1 }, (err) => {
              mqttClient.end();
              if (err) reject(err);
              else resolve();
            });
          });
          mqttClient.on('error', reject);
          setTimeout(() => reject(new Error('MQTT connect timeout')), 5000);
        });
      } catch (mqttErr) {
        const msg = mqttErr instanceof Error ? mqttErr.message : String(mqttErr);
        req.log.warn({ msg: 'MQTT publish failed after device patch', mqttErr: msg });
        return reply.send({ ok: true, mqttWarning: msg });
      }
    }

    return reply.send({ ok: true });
  });

  app.delete<{
    Params: { deviceId: string };
    Querystring: { deployment_slug?: string };
  }>('/api/device/:deviceId', { preHandler: requireAdmin }, async (req, reply) => {
    const { deviceId } = req.params;
    const slug = req.query.deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;

    const { error } = await supabase
      .from('device_configs')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('deployment_slug', slug)
      .eq('device_id', deviceId);

    if (error) {
      req.log.error({ msg: 'deactivate device_configs error', error: error.message });
      return reply.code(500).send({ error: error.message });
    }
    return reply.send({ ok: true });
  });
}
