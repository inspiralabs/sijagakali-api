import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cctvStoragePath } from './cctvSignedUrl.js';

test('cctvStoragePath uses {slug}/{device}/{YYYY-MM-DD}/{unix}_{device}.jpg', () => {
  const now = new Date(2026, 9, 1, 8, 5, 3); // 1 Okt 2026, waktu lokal proses
  const unix = Math.floor(now.getTime() / 1000);
  assert.equal(
    cctvStoragePath('sijagakali-bojong-kulur', 'node-001', now),
    `sijagakali-bojong-kulur/node-001/2026-10-01/${unix}_node-001.jpg`
  );
});

test('cctvStoragePath zero-pads month and day', () => {
  const now = new Date(2026, 0, 5, 0, 0, 0);
  assert.match(cctvStoragePath('s', 'd', now), /^s\/d\/2026-01-05\/\d+_d\.jpg$/);
});
