import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { latestCctvImagePath } from './latestCctvImagePath.js';

/** Supabase palsu: tiap tabel mengembalikan satu baris (atau null) untuk query apa pun. */
function fakeSupabase(rows: { device_configs?: object | null; sensor_readings?: object | null }) {
  const queried: string[] = [];
  const chain = (row: object | null) => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'not', 'order', 'limit']) q[m] = () => q;
    q.maybeSingle = async () => ({ data: row, error: null });
    return q;
  };
  const client = {
    from: (table: 'device_configs' | 'sensor_readings') => {
      queried.push(table);
      return chain(rows[table] ?? null);
    },
  } as unknown as SupabaseClient;
  return { client, queried };
}

test('uses the latest snapshot from device_configs (manual, scheduled, or alarm)', async () => {
  const { client, queried } = fakeSupabase({
    device_configs: { last_snapshot_path: 'slug/node-001/new.jpg' },
    sensor_readings: { cctv_image_path: 'slug/node-001/old.jpg' },
  });
  assert.equal(await latestCctvImagePath(client, 'slug', 'node-001'), 'slug/node-001/new.jpg');
  assert.deepEqual(queried, ['device_configs']);
});

test('falls back to the latest sensor reading photo when no snapshot is recorded', async () => {
  const { client } = fakeSupabase({
    device_configs: { last_snapshot_path: null },
    sensor_readings: { cctv_image_path: 'slug/node-001/old.jpg' },
  });
  assert.equal(await latestCctvImagePath(client, 'slug', 'node-001'), 'slug/node-001/old.jpg');
});

test('returns null when there is no photo anywhere', async () => {
  const { client } = fakeSupabase({ device_configs: null, sensor_readings: null });
  assert.equal(await latestCctvImagePath(client, 'slug', 'node-001'), null);
});
