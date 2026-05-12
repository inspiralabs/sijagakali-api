import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types/deps.js';

export async function registerCctvRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabaseStorage, bucket } = deps;

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
}
