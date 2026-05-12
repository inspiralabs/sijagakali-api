import type { FastifyInstance } from 'fastify';
import { ENV } from '@sijagaair/shared';
import { buildTestPreview } from '../services/notificationMessage.js';
import type { RouteDeps } from '../types/deps.js';

export async function registerNotificationRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, supabaseStorage, bucket, requireAdmin } = deps;

  app.post<{
    Body: {
      device_id: string;
      deployment_slug?: string;
      water_level_cm: number;
      water_status: string;
      include_cctv?: boolean;
      send?: boolean;
    };
  }>('/api/notification/test', { preHandler: requireAdmin }, async (req, reply) => {
    const {
      device_id,
      deployment_slug,
      water_level_cm,
      water_status,
      include_cctv = false,
      send = false,
    } = req.body;

    if (!device_id || water_level_cm === undefined) {
      return reply.code(400).send({ error: 'device_id dan water_level_cm diperlukan' });
    }

    const slug = deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;

    const { data: deviceCfg } = await supabase
      .from('device_configs')
      .select('location_name')
      .eq('deployment_slug', slug)
      .eq('device_id', device_id)
      .maybeSingle();

    const { data: deployment } = await supabase
      .from('deployments')
      .select('whatsapp_message_template')
      .eq('slug', slug)
      .maybeSingle();

    const locationName = deviceCfg?.location_name ?? device_id;
    const template = deployment?.whatsapp_message_template ?? null;

    let cctvSignedUrl: string | null = null;
    if (include_cctv) {
      const { data: latestReading } = await supabase
        .from('sensor_readings')
        .select('cctv_image_path')
        .eq('deployment_slug', slug)
        .eq('device_id', device_id)
        .not('cctv_image_path', 'is', null)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestReading?.cctv_image_path) {
        const { data: signed } = await supabaseStorage.storage
          .from(bucket)
          .createSignedUrl(latestReading.cctv_image_path, 3600);
        cctvSignedUrl = signed?.signedUrl ?? null;
      }
    }

    const preview = buildTestPreview({
      locationName,
      water_level_cm,
      water_status,
      template,
      dashboardUrl: ENV.DASHBOARD_URL || `${ENV.ALLOWED_ORIGIN}/public`,
      isTest: true,
    });

    if (send) {
      try {
        const gatewayUrl = `http://127.0.0.1:${ENV.GATEWAY_HTTP_PORT}/send-test`;
        const body = JSON.stringify({
          device_id,
          deployment_slug: slug,
          water_level_cm,
          water_status,
          location_name: locationName,
          cctv_signed_url: cctvSignedUrl,
          template,
        });
        const res = await fetch(gatewayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        if (!res.ok) {
          const txt = await res.text();
          req.log.warn({ msg: 'gateway send-test gagal', status: res.status, body: txt });
          return reply.send({ preview, sent: false, gatewayError: txt });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.warn({ msg: 'gateway unreachable', error: msg });
        return reply.send({ preview, sent: false, gatewayError: msg });
      }
      return reply.send({ preview, sent: true });
    }

    return reply.send({ preview, sent: false });
  });
}
