import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerLenientJson } from './jsonBodyPlugin.js';
import { parseAllowedOrigins } from './corsPlugin.js';

async function appWithEcho() {
  const app = Fastify();
  registerLenientJson(app);
  app.all('/echo', async (req) => ({ body: req.body ?? null }));
  return app;
}

test('DELETE with Content-Type: application/json and empty body is accepted (no 400)', async () => {
  const app = await appWithEcho();
  const res = await app.inject({ method: 'DELETE', url: '/echo', headers: { 'content-type': 'application/json' } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { body: null });
});

test('valid JSON body is still parsed', async () => {
  const app = await appWithEcho();
  const res = await app.inject({ method: 'POST', url: '/echo', payload: { a: 1 } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { body: { a: 1 } });
});

test('malformed JSON body is still rejected with 400', async () => {
  const app = await appWithEcho();
  const res = await app.inject({
    method: 'POST',
    url: '/echo',
    headers: { 'content-type': 'application/json' },
    payload: '{"a":',
  });
  assert.equal(res.statusCode, 400);
});

test('ALLOWED_ORIGIN entries are normalized to bare origins', () => {
  assert.deepEqual(
    parseAllowedOrigins('https://sijagakali.inspiralabs.id/public, http://localhost:8080/ ,https://a.id'),
    ['https://sijagakali.inspiralabs.id', 'http://localhost:8080', 'https://a.id'],
  );
});

test('invalid ALLOWED_ORIGIN entries are kept as-is (not silently dropped)', () => {
  assert.deepEqual(parseAllowedOrigins('bukan-url'), ['bukan-url']);
});
