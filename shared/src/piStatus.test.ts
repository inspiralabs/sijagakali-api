import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePiHealth, parsePiDeviceMap } from './piStatus.js';

const TS = 1791104565; // 2026-10-04 (detik unix, jam Pi)

test('parsePiHealth reads temp_c (rounded to 1 decimal) and the Pi timestamp', () => {
  assert.deepEqual(parsePiHealth({ temp_c: 52.14, ts: TS }), { tempC: 52.1, at: new Date(TS * 1000) });
  assert.deepEqual(parsePiHealth({ temp_c: -20, ts: TS })?.tempC, -20);
  assert.deepEqual(parsePiHealth({ temp_c: 120, ts: TS })?.tempC, 120);
});

test('parsePiHealth rejects bad temperatures', () => {
  for (const temp_c of ['52.1', null, Number.NaN, Infinity, -20.1, 999, undefined]) {
    assert.equal(parsePiHealth({ temp_c, ts: TS }), null, String(temp_c));
  }
  for (const bad of [null, undefined, 42, 'x', {}]) assert.equal(parsePiHealth(bad), null, JSON.stringify(bad));
});

test('parsePiHealth rejects a missing or implausible timestamp (Pi clock not synced)', () => {
  for (const ts of [undefined, '1791104565', 0, 86400, Number.NaN]) {
    assert.equal(parsePiHealth({ temp_c: 50, ts }), null, String(ts));
  }
});

test('parsePiDeviceMap maps Pi ids to device ids', () => {
  const m = parsePiDeviceMap(' sijagakali-pi-001=node-001 , pi-002=node-002 ');
  assert.equal(m.get('sijagakali-pi-001'), 'node-001');
  assert.equal(m.get('pi-002'), 'node-002');
  assert.equal(m.size, 2);
});

test('parsePiDeviceMap ignores malformed entries', () => {
  assert.equal(parsePiDeviceMap('').size, 0);
  assert.equal(parsePiDeviceMap('novalue,=node-1,pi-1=,a=b=c').size, 0);
});
