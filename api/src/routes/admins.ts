import type { FastifyInstance } from 'fastify';
import type { RouteDeps } from '../types/deps.js';

export async function registerAdminRoutes(app: FastifyInstance, deps: RouteDeps) {
  const { supabase, requireAdmin } = deps;

  app.get('/api/admins', { preHandler: requireAdmin }, async (_req, reply) => {
    const { data, error } = await supabase
      .from('admins')
      .select('id, email, display_name, is_default, created_at')
      .order('created_at', { ascending: true });

    if (error) return reply.code(500).send({ error: error.message });
    return reply.send({ admins: data });
  });

  app.post<{
    Body: { email: string; password: string; display_name?: string };
  }>('/api/admins', { preHandler: requireAdmin }, async (req, reply) => {
    const { email, password, display_name } = req.body;

    if (!email || !password) {
      return reply.code(400).send({ error: 'email dan password diperlukan' });
    }

    const { data: newUser, error: createErr } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr || !newUser?.user) {
      return reply.code(400).send({ error: createErr?.message ?? 'Gagal membuat user' });
    }

    const { data, error: insertErr } = await supabase
      .from('admins')
      .insert({ id: newUser.user.id, email, display_name: display_name ?? null, is_default: false })
      .select()
      .single();

    if (insertErr) {
      await supabase.auth.admin.deleteUser(newUser.user.id);
      return reply.code(500).send({ error: insertErr.message });
    }

    return reply.code(201).send({ admin: data });
  });

  app.patch<{
    Params: { id: string };
    Body: { display_name?: string; email?: string; password?: string };
  }>('/api/admins/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const { id } = req.params;
    const { display_name, email, password } = req.body;

    const adminUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (display_name !== undefined) adminUpdates.display_name = display_name;
    if (email !== undefined) adminUpdates.email = email;

    if (Object.keys(adminUpdates).length > 1) {
      const { error } = await supabase.from('admins').update(adminUpdates).eq('id', id);
      if (error) return reply.code(500).send({ error: error.message });
    }

    if (email || password) {
      const authUpdate: Record<string, string> = {};
      if (email) authUpdate.email = email;
      if (password) authUpdate.password = password;

      const { error: authErr } = await supabase.auth.admin.updateUserById(id, authUpdate);
      if (authErr) return reply.code(500).send({ error: authErr.message });
    }

    return reply.send({ ok: true });
  });

  app.delete<{ Params: { id: string } }>(
    '/api/admins/:id',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const { id } = req.params;

      const { data: adminRow, error: fetchErr } = await supabase
        .from('admins')
        .select('is_default')
        .eq('id', id)
        .maybeSingle();

      if (fetchErr) return reply.code(500).send({ error: fetchErr.message });
      if (!adminRow) return reply.code(404).send({ error: 'Admin tidak ditemukan' });
      if (adminRow.is_default) {
        return reply.code(403).send({ error: 'Admin default tidak dapat dihapus' });
      }

      const { error: delErr } = await supabase.from('admins').delete().eq('id', id);
      if (delErr) return reply.code(500).send({ error: delErr.message });

      await supabase.auth.admin.deleteUser(id);

      return reply.send({ ok: true });
    },
  );
}
