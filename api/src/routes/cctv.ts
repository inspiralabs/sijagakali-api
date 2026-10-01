import type { FastifyInstance } from 'fastify';
import { ENV, captureSnapshot } from '@sijagakali/shared';
import type { RouteDeps } from '../types/deps.js';

export async function registerCctvRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, supabaseStorage, bucket, requireAdmin } = deps;

  app.get<{ Querystring: { path: string; expiresIn?: string } }>(
    '/api/cctv/signed-url',
    async (req, reply) => {
      const { path, expiresIn } = req.query;
      if (!path) {
        return reply.code(400).send({ error: 'path query param required' });
      }

      const expires = Math.min(Math.max(parseInt(expiresIn ?? '86400', 10), 60), 86400);

      const { data, error } = await supabaseStorage.storage
        .from(bucket)
        .createSignedUrl(path, expires);

      if (error) {
        req.log.error({ msg: 'signed URL error', path, error: error.message });
        return reply.code(500).send({ error: error.message });
      }

      return reply.send({ signedUrl: data.signedUrl, expiresIn: expires });
    },
  );

  app.post<{ Params: { deviceId: string }; Body: { deployment_slug?: string } | undefined }>(
    '/api/cctv/:deviceId/snapshot',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const slug = req.body?.deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;
      const { deviceId } = req.params;

      const { data, error } = await supabase
        .from('device_configs')
        .select('cctv_local_ip')
        .eq('deployment_slug', slug)
        .eq('device_id', deviceId)
        .maybeSingle();
      if (error) return reply.code(500).send({ error: error.message });

      const host = (data?.cctv_local_ip as string | null | undefined)?.trim();
      if (!host) return reply.code(404).send({ error: 'Perangkat belum punya IP kamera (cctv_local_ip)' });

      const path = await captureSnapshot({ host, deploymentSlug: slug, deviceId });
      if (!path) return reply.code(502).send({ error: 'Gagal mengambil snapshot dari kamera' });

      const { data: signed, error: signErr } = await supabaseStorage.storage
        .from(bucket)
        .createSignedUrl(path, 3600);
      if (signErr) return reply.code(500).send({ error: signErr.message });

      return reply.send({ path, signedUrl: signed.signedUrl });
    },
  );
}
