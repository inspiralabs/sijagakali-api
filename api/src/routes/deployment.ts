import type { FastifyInstance } from 'fastify';
import { ENV } from '@sijagakali/shared';
import type { RouteDeps } from '../types/deps.js';

export async function registerDeploymentRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, requireAdmin } = deps;

  app.patch<{
    Body: {
      deployment_slug?: string;
      whatsapp_message_template?: string | null;
      wa_template_normal?: string | null;
      wa_template_waspada?: string | null;
      wa_template_siaga?: string | null;
      wa_template_bahaya?: string | null;
      contact_petugas?: string | null;
      contact_bpbd?: string | null;
      contact_posko?: string | null;
    };
  }>('/api/deployment/template', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body;
    const slug = b.deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;

    const updates: Record<string, string | null> = {};
    if ('whatsapp_message_template' in b) {
      updates.whatsapp_message_template = b.whatsapp_message_template ?? null;
    }
    if ('wa_template_normal' in b) updates.wa_template_normal = b.wa_template_normal ?? null;
    if ('wa_template_waspada' in b) updates.wa_template_waspada = b.wa_template_waspada ?? null;
    if ('wa_template_siaga' in b) updates.wa_template_siaga = b.wa_template_siaga ?? null;
    if ('wa_template_bahaya' in b) updates.wa_template_bahaya = b.wa_template_bahaya ?? null;
    if ('contact_petugas' in b) updates.contact_petugas = b.contact_petugas ?? null;
    if ('contact_bpbd' in b) updates.contact_bpbd = b.contact_bpbd ?? null;
    if ('contact_posko' in b) updates.contact_posko = b.contact_posko ?? null;

    if (Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'Tidak ada field template/kontak yang dikirim' });
    }

    const { error } = await supabase.from('deployments').update(updates).eq('slug', slug);

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
