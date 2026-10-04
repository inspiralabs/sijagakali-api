import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePiTemp } from './piStatus.js';

test('parsePiTemp accepts a number in range, rounded to 1 decimal', () => {
  assert.equal(parsePiTemp({ pi_temp_c: 52.14 }), 52.1);
  assert.equal(parsePiTemp({ pi_temp_c: -20 }), -20);
  assert.equal(parsePiTemp({ pi_temp_c: 120 }), 120);
});

test('parsePiTemp rejects non-numbers and out-of-range values', () => {
  for (const bad of [
    null, undefined, 42, 'x', {}, { pi_temp_c: '52.1' }, { pi_temp_c: null },
    { pi_temp_c: Number.NaN }, { pi_temp_c: Infinity }, { pi_temp_c: -20.1 }, { pi_temp_c: 999 },
  ]) {
    assert.equal(parsePiTemp(bad), null, JSON.stringify(bad));
  }
});
