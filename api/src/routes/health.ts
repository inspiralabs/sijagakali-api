import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/api/health', async (_req, reply) => {
    return reply.send({ status: 'ok', ts: new Date().toISOString() });
  });
}
