import 'dotenv/config';
import { ENV } from '@sijagakali/shared';
import { buildApp } from './app.js';

const app = await buildApp();
const port = ENV.FASTIFY_PORT;
await app.listen({ port, host: '0.0.0.0' });
console.log(`[api] Fastify listening on port ${port}`);
