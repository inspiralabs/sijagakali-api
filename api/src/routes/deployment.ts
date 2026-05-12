import type { FastifyInstance } from 'fastify';
import { ENV } from '@sijagaair/shared';
import type { RouteDeps } from '../types/deps.js';

export async function registerDeploymentRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, requireAdmin } = deps;

  app.patch<{
    Body: { deployment_slug?: string; whatsapp_message_template: string | null };
  }>('/api/deployment/template', { preHandler: requireAdmin }, async (req, reply) => {
    const { deployment_slug, whatsapp_message_template } = req.body;
    const slug = deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;

    const { error } = await supabase
      .from('deployments')
      .update({ whatsapp_message_template: whatsapp_message_template ?? null })
      .eq('slug', slug);

    if (error) {
      req.log.error({ msg: 'PATCH deployment template error', error: error.message });
      return reply.code(500).send({ error: error.message });
    }

    try {
      await fetch(`http://127.0.0.1:${ENV.GATEWAY_HTTP_PORT}/invalidate-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deployment_slug: slug }),
      });
    } catch {
      req.log.warn({
        msg: 'Gagal invalidate template cache di gateway (gateway mungkin belum jalan)',
      });
    }

    return reply.send({ ok: true });
  });
}
