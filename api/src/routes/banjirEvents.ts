import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types/deps.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function trimmedNonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export async function registerBanjirEventRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, requireAdmin } = deps;

  app.post<{
    Body: {
      deployment_slug: string;
      nama: string;
      tanggal_mulai: string;
      tanggal_selesai?: string | null;
      keterangan?: string | null;
    };
  }>('/api/banjir/events', { preHandler: requireAdmin }, async (req, reply) => {
    const deploymentSlug = trimmedNonEmpty(req.body.deployment_slug);
    const nama = trimmedNonEmpty(req.body.nama);
    const tanggalMulai = req.body.tanggal_mulai;

    if (!deploymentSlug) return reply.code(400).send({ error: 'deployment_slug wajib diisi' });
    if (!nama) return reply.code(400).send({ error: 'nama kejadian wajib diisi' });
    if (!DATE_RE.test(tanggalMulai ?? '')) {
      return reply.code(400).send({ error: 'tanggal_mulai wajib diisi, format YYYY-MM-DD' });
    }
    if (req.body.tanggal_selesai && !DATE_RE.test(req.body.tanggal_selesai)) {
      return reply.code(400).send({ error: 'tanggal_selesai harus format YYYY-MM-DD' });
    }

    const { data, error } = await supabase
      .from('banjir_events')
      .insert({
        deployment_slug: deploymentSlug,
        nama,
        tanggal_mulai: tanggalMulai,
        tanggal_selesai: req.body.tanggal_selesai || null,
        keterangan: req.body.keterangan?.trim() || null,
      })
      .select('id, deployment_slug, nama, tanggal_mulai, tanggal_selesai, keterangan, created_at')
      .single();

    if (error) {
      req.log.error({ msg: 'INSERT banjir_events error', error: error.message });
      return reply.code(500).send({ error: error.message });
    }
    return reply.code(201).send({ event: data });
  });

  app.patch<{
    Params: { id: string };
    Body: {
      nama?: string;
      tanggal_mulai?: string;
      tanggal_selesai?: string | null;
      keterangan?: string | null;
    };
  }>('/api/banjir/events/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params;
    const b = req.body;
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (b.nama !== undefined) {
      const nama = trimmedNonEmpty(b.nama);
      if (!nama) return reply.code(400).send({ error: 'nama kejadian wajib diisi' });
      updates.nama = nama;
    }
    if (b.tanggal_mulai !== undefined) {
      if (!DATE_RE.test(b.tanggal_mulai)) {
        return reply.code(400).send({ error: 'tanggal_mulai harus format YYYY-MM-DD' });
      }
      updates.tanggal_mulai = b.tanggal_mulai;
    }
    if (b.tanggal_selesai !== undefined) {
      if (b.tanggal_selesai && !DATE_RE.test(b.tanggal_selesai)) {
        return reply.code(400).send({ error: 'tanggal_selesai harus format YYYY-MM-DD' });
      }
      updates.tanggal_selesai = b.tanggal_selesai || null;
    }
    if (b.keterangan !== undefined) {
      updates.keterangan = b.keterangan?.trim() || null;
    }

    const { error } = await supabase.from('banjir_events').update(updates).eq('id', id);
    if (error) {
      req.log.error({ msg: 'PATCH banjir_events error', error: error.message });
      return reply.code(500).send({ error: error.message });
    }
    return reply.send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>(
    '/api/banjir/events/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { error } = await supabase.from('banjir_events').delete().eq('id', req.params.id);
      if (error) {
        req.log.error({ msg: 'DELETE banjir_events error', error: error.message });
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );
}
