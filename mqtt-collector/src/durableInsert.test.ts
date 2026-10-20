import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { flushSpool, saveDurably, type InsertFn, type Row } from './durableInsert.js';

const spoolFile = () => join(mkdtempSync(join(tmpdir(), 'sjk-spool-')), 'spool', 'mqtt_ingestion.jsonl');
const ok: InsertFn = async () => ({ error: null });
const down: InsertFn = async () => ({ error: { message: 'fetch failed' } });
const row = { correlation_id: 'c-1', water_level_cm: 120 };

test('saveDurably: tersimpan langsung → db', async () => {
  assert.equal(await saveDurably(ok, row, spoolFile(), []), 'db');
});

test('saveDurably: duplikat correlation_id (23505) dianggap tersimpan', async () => {
  const dup: InsertFn = async () => ({ error: { code: '23505', message: 'duplicate key' } });
  assert.equal(await saveDurably(dup, row, spoolFile(), []), 'db');
});

test('saveDurably: gagal sesaat lalu berhasil → db, tanpa spool', async () => {
  let calls = 0;
  const flaky: InsertFn = async () => (++calls < 2 ? { error: { message: 'timeout' } } : { error: null });
  const file = spoolFile();
  assert.equal(await saveDurably(flaky, row, file, [0]), 'db');
  assert.equal(calls, 2);
  assert.equal(existsSync(file), false);
});

test('saveDurably: DB mati (termasuk throw) → spool, lalu flushSpool memasukkannya', async () => {
  const file = spoolFile();
  const thrown: InsertFn = async () => {
    throw new Error('ECONNREFUSED');
  };
  assert.equal(await saveDurably(down, row, file, [0]), 'spool');
  assert.equal(await saveDurably(thrown, { ...row, correlation_id: 'c-2' }, file, []), 'spool');

  assert.equal(await flushSpool(down, file), 0); // DB masih mati: isi tetap di spool
  assert.equal(readFileSync(file, 'utf8').trim().split('\n').length, 2);

  const inserted: Row[] = [];
  assert.equal(await flushSpool(async (r) => (inserted.push(r), { error: null }), file), 2);
  assert.deepEqual(inserted.map((r) => r.correlation_id), ['c-1', 'c-2']);
  assert.equal(existsSync(file), false);
  assert.equal(existsSync(`${file}.flushing`), false);
});

test('saveDurably: spool tidak bisa ditulis → failed (jangan PUBACK)', async () => {
  const file = join(spoolFile(), '\0invalid');
  assert.equal(await saveDurably(down, row, file, []), 'failed');
});
