import type { FastifyInstance } from 'fastify';
import { ENV, BMKG_ADM4_RE, getForecast } from '@sijagakali/shared';
import type { RouteDeps } from '../types/deps.js';

type DeviceWeatherRow = {
  device_id: string;
  location_name: string;
  display_name: string | null;
  bmkg_adm4: string | null;
};

function deviceLabel(row: DeviceWeatherRow): string {
  if (row.display_name?.trim()) return row.display_name.trim();
  return row.location_name;
}

export async function registerWeatherRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, requireAdmin } = deps;

  async function loadActiveDevices(slug: string): Promise<DeviceWeatherRow[]> {
    const { data, error } = await supabase
      .from('device_configs')
      .select('device_id, location_name, display_name, bmkg_adm4')
      .eq('deployment_slug', slug)
      .eq('is_active', true)
      .order('device_id');

    if (error) throw new Error(error.message);
    return (data ?? []) as DeviceWeatherRow[];
  }

  app.get<{
    Querystring: { deployment_slug?: string; device_id: string };
  }>('/api/weather/forecast', async (req, reply) => {
    const slug = req.query.deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;
    const deviceId = req.query.device_id;
    if (!deviceId) return reply.code(400).send({ error: 'device_id query param required' });

    const { data: row, error } = await supabase
      .from('device_configs')
      .select('device_id, location_name, display_name, bmkg_adm4')
      .eq('deployment_slug', slug)
      .eq('device_id', deviceId)
      .eq('is_active', true)
      .maybeSingle();

    if (error) return reply.code(500).send({ error: error.message });
    if (!row) return reply.code(404).send({ error: 'Perangkat tidak ditemukan' });
    if (!row.bmkg_adm4) {
      return reply.code(404).send({ error: 'Kode ADM4 BMKG belum dikonfigurasi untuk perangkat ini' });
    }

    try {
      const forecast = await getForecast(row.bmkg_adm4);
      return reply.send({
        device_id: deviceId,
        device_name: deviceLabel(row as DeviceWeatherRow),
        adm4: row.bmkg_adm4,
        forecast,
        attribution: 'Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      req.log.warn({ msg: 'BMKG forecast error', deviceId, error: msg });
      return reply.code(502).send({ error: msg });
    }
  });

  app.get<{
    Querystring: { deployment_slug?: string };
  }>('/api/weather/forecast/batch', async (req, reply) => {
    const slug = req.query.deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;

    let devices: DeviceWeatherRow[];
    try {
      devices = await loadActiveDevices(slug);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return reply.code(500).send({ error: msg });
    }

    const adm4Cache = new Map<string, Awaited<ReturnType<typeof getForecast>>>();
    const items: Array<{
      device_id: string;
      device_name: string;
      adm4: string | null;
      forecast: Awaited<ReturnType<typeof getForecast>> | null;
      error: string | null;
    }> = [];

    await Promise.all(
      devices.map(async (d) => {
        if (!d.bmkg_adm4) {
          items.push({
            device_id: d.device_id,
            device_name: deviceLabel(d),
            adm4: null,
            forecast: null,
            error: 'ADM4 belum dikonfigurasi',
          });
          return;
        }
        try {
          let forecast = adm4Cache.get(d.bmkg_adm4);
          if (!forecast) {
            forecast = await getForecast(d.bmkg_adm4);
            adm4Cache.set(d.bmkg_adm4, forecast);
          }
          items.push({
            device_id: d.device_id,
            device_name: deviceLabel(d),
            adm4: d.bmkg_adm4,
            forecast,
            error: null,
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          items.push({
            device_id: d.device_id,
            device_name: deviceLabel(d),
            adm4: d.bmkg_adm4,
            forecast: null,
            error: msg,
          });
        }
      })
    );

    items.sort((a, b) => a.device_id.localeCompare(b.device_id));

    return reply.send({
      deployment_slug: slug,
      items,
      attribution: 'Sumber data: BMKG (Badan Meteorologi, Klimatologi, dan Geofisika)',
      fetched_at: new Date().toISOString(),
    });
  });

  app.patch<{
    Params: { deviceId: string };
    Body: {
      deployment_slug?: string;
      bmkg_adm4?: string | null;
    };
  }>('/api/device/:deviceId/weather', { preHandler: requireAdmin }, async (req, reply) => {
    const { deviceId } = req.params;
    const slug = req.body.deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;
    const { bmkg_adm4 } = req.body;

    if (!('bmkg_adm4' in req.body)) {
      return reply.code(400).send({ error: 'Tidak ada field cuaca yang dikirim' });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (bmkg_adm4 === null || bmkg_adm4 === '') {
      updates.bmkg_adm4 = null;
    } else {
      const trimmed = String(bmkg_adm4).trim();
      if (!BMKG_ADM4_RE.test(trimmed)) {
        return reply.code(400).send({
          error: 'Format kode ADM4 tidak valid (contoh: 32.01.02.2002)',
        });
      }
      updates.bmkg_adm4 = trimmed;
    }

    const { error } = await supabase
      .from('device_configs')
      .update(updates)
      .eq('deployment_slug', slug)
      .eq('device_id', deviceId);

    if (error) {
      req.log.error({ msg: 'PATCH device weather error', error: error.message });
      return reply.code(500).send({ error: error.message });
    }

    return reply.send({ ok: true });
  });
}
