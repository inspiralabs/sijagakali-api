import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sensorHealth, formatSensorHealthMessage, healthTransition } from './sensorHealth.js';

const NOW = Date.parse('2026-10-01T10:00:00Z');
const minAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const base = { readIntervalSec: 60, now: NOW };

test('fresh reading → ok', () => {
  assert.equal(sensorHealth({ ...base, lastReadingAt: minAgo(2), lastSeenAt: minAgo(1) }), 'ok');
});

test('device never reported a reading → unknown (no alert for not-yet-installed devices)', () => {
  assert.equal(sensorHealth({ ...base, lastReadingAt: null, lastSeenAt: minAgo(1) }), 'unknown');
});

test('readings stale but heartbeat recent → sensor_fault', () => {
  assert.equal(sensorHealth({ ...base, lastReadingAt: minAgo(20), lastSeenAt: minAgo(3) }), 'sensor_fault');
});

test('readings and heartbeat both stale → offline', () => {
  assert.equal(sensorHealth({ ...base, lastReadingAt: minAgo(40), lastSeenAt: minAgo(40) }), 'offline');
  assert.equal(sensorHealth({ ...base, lastReadingAt: minAgo(40), lastSeenAt: null }), 'offline');
});

test('stale threshold = 3× read interval, never below 10 minutes', () => {
  // interval 60 s → threshold 10 min (floor)
  assert.equal(sensorHealth({ ...base, lastReadingAt: minAgo(9), lastSeenAt: minAgo(1) }), 'ok');
  assert.equal(sensorHealth({ ...base, lastReadingAt: minAgo(11), lastSeenAt: minAgo(1) }), 'sensor_fault');
  // interval 1 h → threshold 3 h
  const hourly = { readIntervalSec: 3600, now: NOW };
  assert.equal(sensorHealth({ ...hourly, lastReadingAt: minAgo(170), lastSeenAt: minAgo(1) }), 'ok');
  assert.equal(sensorHealth({ ...hourly, lastReadingAt: minAgo(190), lastSeenAt: minAgo(1) }), 'sensor_fault');
});

test('healthTransition: announce fresh outages and recoveries, nothing on no change', () => {
  assert.equal(healthTransition('ok', 'ok', minAgo(1), NOW), 'none');
  assert.equal(healthTransition('ok', 'unknown', null, NOW), 'none');
  assert.equal(healthTransition('ok', 'sensor_fault', minAgo(30), NOW), 'announce');
  assert.equal(healthTransition('sensor_fault', 'offline', minAgo(60), NOW), 'announce');
  assert.equal(healthTransition('offline', 'ok', minAgo(1), NOW), 'announce'); // pulih
});

test('healthTransition: outage already older than 24 h when first seen is recorded silently', () => {
  // mis. perangkat mati sejak sebulan lalu saat service baru di-deploy/restart
  assert.equal(healthTransition('ok', 'offline', minAgo(25 * 60), NOW), 'record');
  assert.equal(healthTransition('ok', 'offline', minAgo(23 * 60), NOW), 'announce');
});

test('messages name the post and the last data time', () => {
  const fault = formatSensorHealthMessage('sensor_fault', 'Sungai Cileungsi', '2026-10-01T09:40:00Z');
  assert.match(fault, /Sensor .*Sungai Cileungsi.* gangguan/);
  assert.match(fault, /16:40/); // 09:40 UTC = 16:40 WIB
  const offline = formatSensorHealthMessage('offline', 'Sungai Cileungsi', '2026-10-01T09:40:00Z');
  assert.match(offline, /offline/);
  const back = formatSensorHealthMessage('ok', 'Sungai Cileungsi', '2026-10-01T09:40:00Z');
  assert.match(back, /kembali normal/);
});
