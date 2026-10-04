import type { FastifyInstance } from 'fastify';

/**
 * Body JSON kosong dianggap "tanpa body", bukan 400 FST_ERR_CTP_EMPTY_JSON_BODY.
 * Dashboard mengirim header `Content-Type: application/json` juga pada DELETE tanpa body
 * (hapus wilayah, kejadian banjir, dll.). JSON rusak tetap ditolak 400.
 */
export function registerLenientJson(app: FastifyInstance) {
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    const text = String(body).trim();
    if (text === '') {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch (err) {
      const e = err as Error & { statusCode?: number };
      e.statusCode = 400;
      done(e, undefined);
    }
  });
}
