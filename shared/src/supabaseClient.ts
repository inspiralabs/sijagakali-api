import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV } from './env.js';

let _client: SupabaseClient | null = null;

/**
 * Singleton Supabase client memakai service_role — hanya untuk server.
 * Schema default: sijagaair.
 */
export function getSupabase(): SupabaseClient {
  if (!_client) {
    _client = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, {
      db: { schema: 'sijagaair' },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

/** Client khusus untuk Storage (schema public, tapi auth service role). */
export function getSupabaseStorage(): SupabaseClient {
  return createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
