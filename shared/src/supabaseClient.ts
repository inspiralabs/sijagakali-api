import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV } from './env.js';

/** Klien server tanpa generics schema DB (PostgREST memakai `db.schema` saat runtime). */
type ServerSupabase = SupabaseClient<any, any, any, any, any>;

let _client: ServerSupabase | null = null;

/**
 * Singleton Supabase client memakai service_role — hanya untuk server.
 * Schema default: sijagaair.
 */
export function getSupabase(): ServerSupabase {
  if (!_client) {
    _client = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, {
      db: { schema: 'sijagaair' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

/** Client khusus untuk Storage (schema public, tapi auth service role). */
export function getSupabaseStorage(): ServerSupabase {
  return createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
