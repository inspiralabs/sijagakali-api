import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';

export type CorsEnv = Pick<{ ALLOWED_ORIGIN: string }, 'ALLOWED_ORIGIN'>;

/** CORS: origin dari ENV.ALLOWED_ORIGIN. */
export async function registerCors(app: FastifyInstance, env: CorsEnv) {
  await app.register(cors, {
    origin: env.ALLOWED_ORIGIN,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });
}
