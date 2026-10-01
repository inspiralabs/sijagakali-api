import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  buildDigestAuth,
  parseDigestParams,
  fetchHikvisionSnapshot,
  HIKVISION_SNAPSHOT_URI,
} from './hikvision.js';
import { startTestServer } from './httpServer.test-util.js';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

test('buildDigestAuth matches RFC 2617 example', () => {
  const header = buildDigestAuth({
    method: 'GET',
    uri: '/dir/index.html',
    username: 'Mufasa',
    password: 'Circle Of Life',
    challenge:
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41"',
    nc: '00000001',
    cnonce: '0a4f113b',
  });
  assert.match(header, /^Digest /);
  assert.equal(parseDigestParams(header).response, '6629fae49393a05397450978507c4ef1');
  assert.equal(parseDigestParams(header).opaque, '5ccc069c403ebaf9f0171e9517f40e41');
});

/** Kamera palsu: 401 + challenge digest, 200 JPEG bila response digest benar. */
function fakeCamera(password: string, contentType = 'image/jpeg', uri = HIKVISION_SNAPSHOT_URI) {
  const realm = 'IP Camera(C1234)';
  const nonce = 'abc123nonce';
  return startTestServer((req, res) => {
    const auth = req.headers.authorization;
    if (auth) {
      const p = parseDigestParams(auth);
      const ha1 = md5(`${p.username}:${realm}:${password}`);
      const ha2 = md5(`GET:${p.uri}`);
      const expected = md5(`${ha1}:${nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`);
      if (p.response === expected && p.uri === uri) {
        res.writeHead(200, { 'Content-Type': contentType }).end(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
        return;
      }
    }
    res
      .writeHead(401, { 'WWW-Authenticate': `Digest qop="auth", realm="${realm}", nonce="${nonce}", stale="FALSE"` })
      .end();
  });
}

test('fetchHikvisionSnapshot returns JPEG after digest handshake', async () => {
  const cam = await fakeCamera('rahasia');
  try {
    const host = cam.url.replace('http://', '');
    const buf = await fetchHikvisionSnapshot(host, { username: 'sijagakali', password: 'rahasia', timeoutMs: 2000 });
    assert.deepEqual([...buf], [0xff, 0xd8, 0xff, 0xd9]);
  } finally {
    cam.close();
  }
});

test('fetchHikvisionSnapshot can fetch the sub stream (channel 102)', async () => {
  const cam = await fakeCamera('rahasia', 'image/jpeg', '/ISAPI/Streaming/channels/102/picture');
  try {
    const host = cam.url.replace('http://', '');
    const buf = await fetchHikvisionSnapshot(host, { username: 'sijagakali', password: 'rahasia', timeoutMs: 2000, channel: 102 });
    assert.deepEqual([...buf], [0xff, 0xd8, 0xff, 0xd9]);
  } finally {
    cam.close();
  }
});

test('fetchHikvisionSnapshot: wrong password rejects', async () => {
  const cam = await fakeCamera('rahasia');
  try {
    const host = cam.url.replace('http://', '');
    await assert.rejects(
      fetchHikvisionSnapshot(host, { username: 'sijagakali', password: 'salah', timeoutMs: 2000 }),
      /HTTP 401/
    );
  } finally {
    cam.close();
  }
});

test('fetchHikvisionSnapshot rejects non-JPEG 200 responses', async () => {
  const cam = await fakeCamera('rahasia', 'text/html');
  try {
    const host = cam.url.replace('http://', '');
    await assert.rejects(
      fetchHikvisionSnapshot(host, { username: 'sijagakali', password: 'rahasia', timeoutMs: 2000 }),
      /content-type/
    );
  } finally {
    cam.close();
  }
});

test('fetchHikvisionSnapshot times out when camera hangs', async () => {
  const cam = await startTestServer(() => {
    /* tidak pernah membalas */
  });
  try {
    const host = cam.url.replace('http://', '');
    const started = Date.now();
    await assert.rejects(fetchHikvisionSnapshot(host, { username: 'u', password: 'p', timeoutMs: 300 }));
    assert.ok(Date.now() - started < 2000, 'harus berhenti dekat timeoutMs');
  } finally {
    cam.close();
  }
});
