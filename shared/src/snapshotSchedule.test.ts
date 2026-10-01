import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSnapshotDue } from './snapshotSchedule.js';

const NOW = Date.parse('2026-10-01T10:00:00Z');
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

test('never snapshotted → due', () => {
  assert.equal(isSnapshotDue(null, 15, NOW), true);
  assert.equal(isSnapshotDue(undefined, 15, NOW), true);
});

test('interval 0 or negative → never due (periodic off)', () => {
  assert.equal(isSnapshotDue(null, 0, NOW), false);
  assert.equal(isSnapshotDue(minAgo(999), -5, NOW), false);
});

test('due exactly at interval, not before', () => {
  assert.equal(isSnapshotDue(minAgo(14), 15, NOW), false);
  assert.equal(isSnapshotDue(minAgo(15), 15, NOW), true);
  assert.equal(isSnapshotDue(minAgo(60), 15, NOW), true);
});

test('accepts epoch ms', () => {
  assert.equal(isSnapshotDue(NOW - 5 * 60_000, 15, NOW), false);
  assert.equal(isSnapshotDue(NOW - 15 * 60_000, 15, NOW), true);
});

test('unparseable timestamp → due (self-heal)', () => {
  assert.equal(isSnapshotDue('bukan-tanggal', 15, NOW), true);
});
