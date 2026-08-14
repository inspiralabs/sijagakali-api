import type { FastifyInstance } from 'fastify';
import { ENV, type DeploymentWaRow, createCctvSignedUrlFlexible } from '@sijagakali/shared';
import {
  buildTestPreview,
  buildTestEventFromDeviceAndDeployment,
  parseWaterStatus,
  DEPLOYMENT_WA_COLUMNS,
  type SkipImageReason,
} from '../services/notificationMessage.js';
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
      message_text?: string | null;
    };
  }>('/api/notification/test', { preHandler: requireAdmin }, async (req, reply) => {
    const {
      device_id,
      deployment_slug,
      water_level_cm,
      water_status: waterStatusRaw,
      include_cctv = false,
      send = false,
      message_text,
    } = req.body;

    if (!device_id || water_level_cm === undefined) {
      return reply.code(400).send({ error: 'device_id dan water_level_cm diperlukan' });
    }

    const ws = parseWaterStatus(waterStatusRaw);
    if (!ws) {
      return reply.code(400).send({ error: 'water_status harus normal, waspada, siaga, atau bahaya' });
    }

    const slug = deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;
    const dashboardBase = ENV.DASHBOARD_URL || `${ENV.ALLOWED_ORIGIN}/public`;

    const { data: deviceCfg } = await supabase
      .from('device_configs')
      .select('location_name,read_interval_sec,threshold_waspada_cm,threshold_siaga_cm,threshold_bahaya_cm')
      .eq('deployment_slug', slug)
      .eq('device_id', device_id)
      .maybeSingle();

    const { data: deployment } = await supabase
      .from('deployments')
      .select(DEPLOYMENT_WA_COLUMNS)
      .eq('slug', slug)
      .maybeSingle();

    const depRow = deployment as Partial<DeploymentWaRow> | null;

    const locationName = deviceCfg?.location_name ?? device_id;
    const readInterval = deviceCfg?.read_interval_sec ?? 3600;
    const tw = deviceCfg?.threshold_waspada_cm ?? 0;
    const ts = deviceCfg?.threshold_siaga_cm ?? tw;
    const tb = deviceCfg?.threshold_bahaya_cm ?? ts;

    const event = buildTestEventFromDeviceAndDeployment({
      slug,
      device_id,
      location_name: locationName,
      water_level_cm,
      water_status: ws,
      read_interval_sec: readInterval,
      threshold_waspada_cm: tw,
      threshold_siaga_cm: ts,
      threshold_bahaya_cm: tb,
      deploymentRow: depRow,
    });

    let cctvSignedUrl: string | null = null;
    let skipImageReason: SkipImageReason | null = null;

    if (!include_cctv) {
      skipImageReason = 'unchecked';
    } else {
      const { data: latestReading } = await supabase
        .from('sensor_readings')
        .select('cctv_image_path')
        .eq('deployment_slug', slug)
        .eq('device_id', device_id)
        .not('cctv_image_path', 'is', null)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestReading?.cctv_image_path) {
        skipImageReason = 'no_path';
      } else {
        cctvSignedUrl = await createCctvSignedUrlFlexible(
          supabaseStorage,
          bucket,
          latestReading.cctv_image_path,
          device_id
        );
        if (!cctvSignedUrl) {
          skipImageReason = 'signed_url_failed';
        }
      }
    }

    const preview =
      message_text != null && String(message_text).trim().length > 0
        ? `[TEST]\n${String(message_text).trim()}`
        : buildTestPreview(event, depRow, dashboardBase);

    const imageWouldAttach = include_cctv && cctvSignedUrl != null;
    let imageAttached = imageWouldAttach;
    let resolvedSkip: SkipImageReason | null = skipImageReason;

    if (send) {
      try {
        const gatewayUrl = `http://127.0.0.1:${ENV.GATEWAY_HTTP_PORT}/send-test`;
        const body = JSON.stringify({
          device_id,
          deployment_slug: slug,
          water_level_cm,
          water_status: ws,
          location_name: locationName,
          cctv_signed_url: cctvSignedUrl,
          message_text: message_text ?? undefined,
        });
        const res = await fetch(gatewayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
        });
        const raw = await res.text();
        let gatewayJson: {
          error?: string;
          imageAttached?: boolean;
          imageFallbackUsed?: boolean;
        } = {};
        try {
          gatewayJson = raw ? (JSON.parse(raw) as typeof gatewayJson) : {};
        } catch {
          gatewayJson = { error: raw };
        }
        if (!res.ok) {
          req.log.warn({
            msg: 'gateway send-test gagal',
            status: res.status,
            body: gatewayJson,
          });
          return reply.send({
            preview,
            sent: false,
            gatewayError: gatewayJson.error ?? raw,
            imageAttached: false,
            skipImageReason: resolvedSkip,
          });
        }
        imageAttached = Boolean(gatewayJson.imageAttached);
        if (gatewayJson.imageFallbackUsed) {
          resolvedSkip = 'image_download_failed';
        } else if (!imageAttached && imageWouldAttach) {
          resolvedSkip = resolvedSkip ?? 'image_download_failed';
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        req.log.warn({ msg: 'gateway unreachable', error: msg });
        return reply.send({
          preview,
          sent: false,
          gatewayError: msg,
          imageAttached: false,
          skipImageReason: resolvedSkip,
        });
      }
      return reply.send({
        preview,
        sent: true,
        imageAttached,
        skipImageReason: imageAttached ? null : resolvedSkip,
      });
    }

    return reply.send({
      preview,
      sent: false,
      imageAttached: imageWouldAttach,
      skipImageReason: imageWouldAttach ? null : resolvedSkip,
    });
  });
}
