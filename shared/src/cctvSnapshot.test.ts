import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key';
process.env.CCTV_SNAPSHOT_TIMEOUT_MS = '500';

test('captureSnapshot never throws and returns null when camera is unreachable', async () => {
  const { captureSnapshot } = await import('./cctvSnapshot.js');
  const result = await captureSnapshot({ host: '127.0.0.1:1', deploymentSlug: 's', deviceId: 'node-001' });
  assert.equal(result, null);
});
