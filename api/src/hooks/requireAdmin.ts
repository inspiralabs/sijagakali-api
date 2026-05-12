import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Verifikasi JWT Supabase + baris di sijagaair.admins.
 */
export function createRequireAdmin(supabase: SupabaseClient) {
  return async function requireAdmin(req: FastifyRequest, reply: FastifyReply) {
    const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return reply.code(401).send({ error: 'Authorization header diperlukan' });
    }

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return reply.code(401).send({ error: 'Token tidak valid atau sudah kadaluarsa' });
    }

    const { data: adminRow } = await supabase
      .from('admins')
      .select('id')
      .eq('id', user.id)
      .maybeSingle();

    if (!adminRow) {
      return reply.code(403).send({ error: 'Akun ini bukan admin SiJagaAir' });
    }
  };
}
