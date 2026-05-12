import type { FastifyInstance } from 'fastify';
import { createMqttClient, ENV } from '@sijagaair/shared';
import type { RouteDeps } from '../types/deps.js';

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
          const topic = `sijagaair/${deviceId}/config/interval`;
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
      threshold_waspada_cm?: number;
      threshold_siaga_cm?: number;
      threshold_bahaya_cm?: number;
      read_interval_sec?: number;
    };
  }>('/api/device/:deviceId/settings', { preHandler: requireAdmin }, async (req, reply) => {
    const { deviceId } = req.params;
    const {
      deployment_slug,
      location_name,
      threshold_waspada_cm,
      threshold_siaga_cm,
      threshold_bahaya_cm,
      read_interval_sec,
    } = req.body;

    const slug = deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;

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
    if (threshold_waspada_cm !== undefined) updates.threshold_waspada_cm = threshold_waspada_cm;
    if (threshold_siaga_cm !== undefined) updates.threshold_siaga_cm = threshold_siaga_cm;
    if (threshold_bahaya_cm !== undefined) updates.threshold_bahaya_cm = threshold_bahaya_cm;
    if (read_interval_sec !== undefined) updates.read_interval_sec = read_interval_sec;

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
            const topic = `sijagaair/${deviceId}/config/interval`;
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
}
