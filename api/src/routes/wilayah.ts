import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types/deps.js';

function trimmedNonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

export async function registerWilayahRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, requireAdmin } = deps;

  // ---- Dusun ----
  app.post<{ Body: { deployment_slug: string; nama: string } }>(
    '/api/wilayah/dusun',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const deploymentSlug = trimmedNonEmpty(req.body.deployment_slug);
      const nama = trimmedNonEmpty(req.body.nama);
      if (!deploymentSlug) return reply.code(400).send({ error: 'deployment_slug wajib diisi' });
      if (!nama) return reply.code(400).send({ error: 'nama dusun wajib diisi' });

      const { data, error } = await supabase
        .from('wilayah_dusun')
        .insert({ deployment_slug: deploymentSlug, nama })
        .select('id, deployment_slug, nama, created_at')
        .single();

      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'Nama dusun ini sudah ada' });
        }
        req.log.error({ msg: 'INSERT wilayah_dusun error', error: error.message });
        return reply.code(500).send({ error: error.message });
      }
      return reply.code(201).send({ dusun: data });
    },
  );

  app.patch<{ Params: { id: string }; Body: { nama: string } }>(
    '/api/wilayah/dusun/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const nama = trimmedNonEmpty(req.body.nama);
      if (!nama) return reply.code(400).send({ error: 'nama dusun wajib diisi' });

      const { error } = await supabase.from('wilayah_dusun').update({ nama }).eq('id', req.params.id);
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'Nama dusun ini sudah ada' });
        }
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/wilayah/dusun/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { error } = await supabase.from('wilayah_dusun').delete().eq('id', req.params.id);
      if (error) {
        if (error.code === '23503') {
          return reply.code(409).send({ error: 'Tidak bisa dihapus: masih dipakai oleh RW atau data warga.' });
        }
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );

  // ---- RW ----
  app.post<{ Body: { dusun_id: string; nama: string } }>(
    '/api/wilayah/rw',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const dusunId = trimmedNonEmpty(req.body.dusun_id);
      const nama = trimmedNonEmpty(req.body.nama);
      if (!dusunId) return reply.code(400).send({ error: 'dusun_id wajib diisi' });
      if (!nama) return reply.code(400).send({ error: 'nama RW wajib diisi' });

      const { data, error } = await supabase
        .from('wilayah_rw')
        .insert({ dusun_id: dusunId, nama })
        .select('id, dusun_id, nama, created_at')
        .single();

      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'Nama RW ini sudah ada di dusun tersebut' });
        }
        if (error.code === '23503') {
          return reply.code(400).send({ error: 'Dusun induk tidak ditemukan' });
        }
        req.log.error({ msg: 'INSERT wilayah_rw error', error: error.message });
        return reply.code(500).send({ error: error.message });
      }
      return reply.code(201).send({ rw: data });
    },
  );

  app.patch<{ Params: { id: string }; Body: { nama: string } }>(
    '/api/wilayah/rw/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const nama = trimmedNonEmpty(req.body.nama);
      if (!nama) return reply.code(400).send({ error: 'nama RW wajib diisi' });

      const { error } = await supabase.from('wilayah_rw').update({ nama }).eq('id', req.params.id);
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'Nama RW ini sudah ada di dusun tersebut' });
        }
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/wilayah/rw/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { error } = await supabase.from('wilayah_rw').delete().eq('id', req.params.id);
      if (error) {
        if (error.code === '23503') {
          return reply.code(409).send({ error: 'Tidak bisa dihapus: masih dipakai oleh RT atau data warga.' });
        }
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );

  // ---- RT ----
  app.post<{ Body: { rw_id: string; nama: string } }>(
    '/api/wilayah/rt',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const rwId = trimmedNonEmpty(req.body.rw_id);
      const nama = trimmedNonEmpty(req.body.nama);
      if (!rwId) return reply.code(400).send({ error: 'rw_id wajib diisi' });
      if (!nama) return reply.code(400).send({ error: 'nama RT wajib diisi' });

      const { data, error } = await supabase
        .from('wilayah_rt')
        .insert({ rw_id: rwId, nama })
        .select('id, rw_id, nama, created_at')
        .single();

      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'Nama RT ini sudah ada di RW tersebut' });
        }
        if (error.code === '23503') {
          return reply.code(400).send({ error: 'RW induk tidak ditemukan' });
        }
        req.log.error({ msg: 'INSERT wilayah_rt error', error: error.message });
        return reply.code(500).send({ error: error.message });
      }
      return reply.code(201).send({ rt: data });
    },
  );

  app.patch<{ Params: { id: string }; Body: { nama: string } }>(
    '/api/wilayah/rt/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const nama = trimmedNonEmpty(req.body.nama);
      if (!nama) return reply.code(400).send({ error: 'nama RT wajib diisi' });

      const { error } = await supabase.from('wilayah_rt').update({ nama }).eq('id', req.params.id);
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'Nama RT ini sudah ada di RW tersebut' });
        }
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/wilayah/rt/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { error } = await supabase.from('wilayah_rt').delete().eq('id', req.params.id);
      if (error) {
        if (error.code === '23503') {
          return reply.code(409).send({ error: 'Tidak bisa dihapus: masih dipakai oleh data warga.' });
        }
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );
}
