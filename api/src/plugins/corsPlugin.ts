import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

export type CorsEnv = Pick<{ ALLOWED_ORIGIN: string }, 'ALLOWED_ORIGIN'>;

/**
 * Browser mengirim Origin tanpa path. Entri seperti `https://x.id/public` atau `http://host/`
 * dinormalkan ke origin murni agar tidak diam-diam menolak semua request.
 */
export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
    .map((o) => {
      try {
        return new URL(o).origin;
      } catch {
        return o;
      }
    });
}

/** CORS: dukung satu atau banyak origin (pisahkan koma di ENV.ALLOWED_ORIGIN). */
export async function registerCors(app: FastifyInstance, env: CorsEnv) {
  const allowed = parseAllowedOrigins(env.ALLOWED_ORIGIN);

  await app.register(cors, {
    origin: (origin, cb) => {
      // Permintaan non-browser (curl, server-to-server) tanpa header Origin
      if (!origin) {
        cb(null, true);
        return;
      }
      if (allowed.length === 0) {
        cb(null, true);
        return;
      }
      if (allowed.includes(origin)) {
        cb(null, origin);
        return;
      }
      cb(new Error(`Origin tidak diizinkan: ${origin}`), false);
    },
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
}
