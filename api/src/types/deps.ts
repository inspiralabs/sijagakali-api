import type { SupabaseClient } from '@supabase/supabase-js';
import type { FastifyReply, FastifyRequest } from 'fastify';

/** Dependency injection untuk route handlers. */
export interface RouteDeps {
  supabase: SupabaseClient;
  supabaseStorage: SupabaseClient;
  bucket: string;
  requireAdmin: (req: FastifyRequest, reply: FastifyReply) => Promise<void | FastifyReply>;
}
