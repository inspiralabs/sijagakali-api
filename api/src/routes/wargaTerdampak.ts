import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types/deps.js';

const NIK_RE = /^[0-9]{16}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const JENIS_KELAMIN_VALUES = ['laki-laki', 'perempuan'] as const;
const STATUS_VALUES = ['di_rumah', 'mengungsi', 'lainnya'] as const;

function trimmedNonEmpty(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function optionalTrimmed(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

type WargaBody = {
  banjir_event_id: string;
  deployment_slug: string;
  nik?: string | null;
  nama_lengkap: string;
  tanggal_lahir: string;
  jenis_kelamin: string;
  no_kk?: string | null;
  kontak_hp?: string | null;
  status_saat_ini?: string;
  dusun_id: string;
  rw_id: string;
  rt_id: string;
  detail_alamat?: string | null;
  catatan?: string | null;
};

function validateWargaBody(
  b: Partial<WargaBody>,
  opts: { partial: boolean },
): { ok: true } | { ok: false; error: string } {
  if (!opts.partial || b.nama_lengkap !== undefined) {
    if (!trimmedNonEmpty(b.nama_lengkap)) return { ok: false, error: 'nama_lengkap wajib diisi' };
  }
  if (!opts.partial || b.tanggal_lahir !== undefined) {
    if (!DATE_RE.test(b.tanggal_lahir ?? '')) {
      return { ok: false, error: 'tanggal_lahir wajib diisi, format YYYY-MM-DD' };
    }
  }
  if (!opts.partial || b.jenis_kelamin !== undefined) {
    if (!JENIS_KELAMIN_VALUES.includes(b.jenis_kelamin as (typeof JENIS_KELAMIN_VALUES)[number])) {
      return { ok: false, error: `jenis_kelamin harus salah satu dari: ${JENIS_KELAMIN_VALUES.join(', ')}` };
    }
  }
  if (
    b.status_saat_ini !== undefined &&
    !STATUS_VALUES.includes(b.status_saat_ini as (typeof STATUS_VALUES)[number])
  ) {
    return { ok: false, error: `status_saat_ini harus salah satu dari: ${STATUS_VALUES.join(', ')}` };
  }
  if (b.nik !== undefined && b.nik !== null && b.nik !== '' && !NIK_RE.test(b.nik)) {
    return { ok: false, error: 'nik harus 16 digit angka' };
  }
  if (!opts.partial || b.dusun_id !== undefined) {
    if (!trimmedNonEmpty(b.dusun_id)) return { ok: false, error: 'dusun_id wajib diisi' };
  }
  if (!opts.partial || b.rw_id !== undefined) {
    if (!trimmedNonEmpty(b.rw_id)) return { ok: false, error: 'rw_id wajib diisi' };
  }
  if (!opts.partial || b.rt_id !== undefined) {
    if (!trimmedNonEmpty(b.rt_id)) return { ok: false, error: 'rt_id wajib diisi' };
  }
  return { ok: true };
}

export async function registerWargaTerdampakRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, requireAdmin } = deps;

  app.post<{ Body: WargaBody }>('/api/banjir/warga', { preHandler: requireAdmin }, async (req, reply) => {
    const b = req.body;
    const validation = validateWargaBody(b, { partial: false });
    if (!validation.ok) return reply.code(400).send({ error: validation.error });
    if (!trimmedNonEmpty(b.banjir_event_id)) {
      return reply.code(400).send({ error: 'banjir_event_id wajib diisi' });
    }
    if (!trimmedNonEmpty(b.deployment_slug)) {
      return reply.code(400).send({ error: 'deployment_slug wajib diisi' });
    }

    const row = {
      banjir_event_id: b.banjir_event_id,
      deployment_slug: b.deployment_slug,
      nik: optionalTrimmed(b.nik),
      nama_lengkap: trimmedNonEmpty(b.nama_lengkap),
      tanggal_lahir: b.tanggal_lahir,
      jenis_kelamin: b.jenis_kelamin,
      no_kk: optionalTrimmed(b.no_kk),
      kontak_hp: optionalTrimmed(b.kontak_hp),
      status_saat_ini: b.status_saat_ini ?? 'di_rumah',
      dusun_id: b.dusun_id,
      rw_id: b.rw_id,
      rt_id: b.rt_id,
      detail_alamat: optionalTrimmed(b.detail_alamat),
      catatan: optionalTrimmed(b.catatan),
    };

    const { data, error } = await supabase.from('warga_terdampak').insert(row).select('id').single();
    if (error) {
      if (/duplicate|unique/i.test(error.message)) {
        return reply.code(409).send({ error: 'NIK ini sudah tercatat pada kejadian banjir yang sama' });
      }
      if (error.code === '23503') {
        return reply.code(400).send({ error: 'Kejadian banjir atau wilayah (dusun/RW/RT) tidak ditemukan' });
      }
      req.log.error({ msg: 'INSERT warga_terdampak error', error: error.message });
      return reply.code(500).send({ error: error.message });
    }
    return reply.code(201).send({ id: data.id });
  });

  app.patch<{ Params: { id: string }; Body: Partial<WargaBody> }>(
    '/api/banjir/warga/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const b = req.body;
      const validation = validateWargaBody(b, { partial: true });
      if (!validation.ok) return reply.code(400).send({ error: validation.error });

      const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.nik !== undefined) updates.nik = optionalTrimmed(b.nik);
      if (b.nama_lengkap !== undefined) updates.nama_lengkap = trimmedNonEmpty(b.nama_lengkap);
      if (b.tanggal_lahir !== undefined) updates.tanggal_lahir = b.tanggal_lahir;
      if (b.jenis_kelamin !== undefined) updates.jenis_kelamin = b.jenis_kelamin;
      if (b.no_kk !== undefined) updates.no_kk = optionalTrimmed(b.no_kk);
      if (b.kontak_hp !== undefined) updates.kontak_hp = optionalTrimmed(b.kontak_hp);
      if (b.status_saat_ini !== undefined) updates.status_saat_ini = b.status_saat_ini;
      if (b.dusun_id !== undefined) updates.dusun_id = b.dusun_id;
      if (b.rw_id !== undefined) updates.rw_id = b.rw_id;
      if (b.rt_id !== undefined) updates.rt_id = b.rt_id;
      if (b.detail_alamat !== undefined) updates.detail_alamat = optionalTrimmed(b.detail_alamat);
      if (b.catatan !== undefined) updates.catatan = optionalTrimmed(b.catatan);

      const { error } = await supabase.from('warga_terdampak').update(updates).eq('id', req.params.id);
      if (error) {
        if (/duplicate|unique/i.test(error.message)) {
          return reply.code(409).send({ error: 'NIK ini sudah tercatat pada kejadian banjir yang sama' });
        }
        if (error.code === '23503') {
          return reply.code(400).send({ error: 'Wilayah (dusun/RW/RT) tidak ditemukan' });
        }
        req.log.error({ msg: 'PATCH warga_terdampak error', error: error.message });
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/banjir/warga/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { error } = await supabase.from('warga_terdampak').delete().eq('id', req.params.id);
      if (error) {
        req.log.error({ msg: 'DELETE warga_terdampak error', error: error.message });
        return reply.code(500).send({ error: error.message });
      }
      return reply.send({ ok: true });
    },
  );
}
