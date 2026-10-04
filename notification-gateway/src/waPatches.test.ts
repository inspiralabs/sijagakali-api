import { test } from 'node:test';
import assert from 'node:assert/strict';
import { patchMediaModelId } from './waPatches.js';

test('processMediaData result loses __x_id so it cannot overwrite the outgoing message id', async () => {
  const wwebjs = {
    processMediaData: async (_media: unknown, opts: { sendToChannel: boolean }) => ({
      __x_id: undefined,
      mediaHandle: 'h-1',
      preview: 'p',
      sendToChannel: opts.sendToChannel,
    }),
  };
  patchMediaModelId(wwebjs);
  const out = await wwebjs.processMediaData({}, { sendToChannel: true });
  assert.equal('__x_id' in out, false);
  assert.deepEqual(out, { mediaHandle: 'h-1', preview: 'p', sendToChannel: true });
});

test('patching twice wraps only once', async () => {
  let calls = 0;
  const wwebjs = { processMediaData: async () => { calls++; return { __x_id: 1 }; } };
  patchMediaModelId(wwebjs);
  patchMediaModelId(wwebjs);
  await wwebjs.processMediaData();
  assert.equal(calls, 1);
});
