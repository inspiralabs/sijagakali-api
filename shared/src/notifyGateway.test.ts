import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notifyGateway, parseNotificationEvent } from './notifyGateway.js';
import { startTestServer } from './httpServer.test-util.js';
import type { NotificationEvent } from './types.js';

const event = {
  reading_id: 'r-1',
  deployment_slug: 'sijagakali-bojong-kulur',
  device_id: 'node-001',
  water_level_cm: 120,
  water_status: 'waspada',
} as unknown as NotificationEvent;

test('parseNotificationEvent accepts a valid event', () => {
  assert.deepEqual(parseNotificationEvent(event), event);
});

test('parseNotificationEvent rejects invalid bodies', () => {
  assert.equal(parseNotificationEvent(null), null);
  assert.equal(parseNotificationEvent({ ...event, water_status: 'banjir' }), null);
  assert.equal(parseNotificationEvent({ ...event, reading_id: '' }), null);
  assert.equal(parseNotificationEvent({ ...event, water_level_cm: '120' }), null);
  assert.equal(parseNotificationEvent({ ...event, device_id: undefined }), null);
});

test('notifyGateway POSTs the event as JSON to /notify', async () => {
  let got: { method?: string; url?: string; body?: string } = {};
  const srv = await startTestServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got = { method: req.method, url: req.url, body };
      res.writeHead(202).end('{"ok":true}');
    });
  });
  try {
    assert.equal(await notifyGateway(srv.url, event), true);
    assert.equal(got.method, 'POST');
    assert.equal(got.url, '/notify');
    assert.deepEqual(JSON.parse(got.body ?? ''), event);
  } finally {
    srv.close();
  }
});

test('notifyGateway returns false on non-2xx', async () => {
  const srv = await startTestServer((_req, res) => res.writeHead(500).end());
  try {
    assert.equal(await notifyGateway(srv.url, event), false);
  } finally {
    srv.close();
  }
});

test('notifyGateway returns false when gateway is down', async () => {
  assert.equal(await notifyGateway('http://127.0.0.1:1', event, 2000), false);
});
