import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createReadyWatchdog } from './readyWatchdog.js';

const MIN = 60_000;

function setup() {
  mock.timers.enable({ apis: ['setTimeout'] });
  const stuck: string[] = [];
  const wd = createReadyWatchdog((why) => stuck.push(why), 3 * MIN);
  return { wd, stuck };
}

test('authenticated without ready within the timeout reports stuck', (t) => {
  t.after(() => mock.timers.reset());
  const { wd, stuck } = setup();
  wd.authenticated();
  mock.timers.tick(3 * MIN - 1);
  assert.equal(stuck.length, 0);
  mock.timers.tick(1);
  assert.equal(stuck.length, 1);
});

test('ready in time cancels the watchdog', (t) => {
  t.after(() => mock.timers.reset());
  const { wd, stuck } = setup();
  wd.authenticated();
  mock.timers.tick(2 * MIN);
  wd.ready();
  mock.timers.tick(10 * MIN);
  assert.equal(stuck.length, 0);
});

test('waiting for a QR scan never reports stuck (a restart would not help)', (t) => {
  t.after(() => mock.timers.reset());
  const { wd, stuck } = setup();
  wd.authenticated();
  wd.qr();
  mock.timers.tick(10 * MIN);
  assert.equal(stuck.length, 0);
});

test('repeated authenticated events keep a single timer', (t) => {
  t.after(() => mock.timers.reset());
  const { wd, stuck } = setup();
  wd.authenticated();
  mock.timers.tick(2 * MIN);
  wd.authenticated();
  mock.timers.tick(1 * MIN);
  assert.equal(stuck.length, 1);
});
