# CCTV Live + Snapshot, Broker MQTT VPS, Uji E2E, Deploy OTA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notifikasi WA otomatis benar-benar terkirim (dengan snapshot CCTV Hikvision), ESP32 terkoneksi ke broker MQTT di VPS, live CCTV tampil di dashboard publik hemat kuota, dan OTA firmware jalan di VPS.

**Architecture:** Bus notifikasi in-process (`EventEmitter`) diganti HTTP `POST /notify` ke notification-gateway. Mosquitto masuk docker compose VPS (MQTT internal + WebSocket via Traefik). Raspberry Pi di lokasi menjadi Tailscale subnet router; VPS menarik snapshot ISAPI (digest auth) dan RTSP sub stream on-demand lewat MediaMTX → HLS → `hls.js` di dashboard dengan auto-stop 5 menit. `sijagakali-ota` di-dockerize di network `edge` yang sama.

**Tech Stack:** Node 22 / TypeScript (npm workspaces), Fastify 5, Supabase (Postgres + Storage), mosquitto 2, MediaMTX 1, Tailscale, Traefik (sudah ada di VPS), React 18 + Vite + Vitest (`sijagakali-app`), `hls.js`, ESP32-C5 (PlatformIO).

**Spec:** `docs/superpowers/specs/2026-10-01-cctv-mqtt-ota-design.md`

## Global Constraints

- Runtime container: `node:22-bookworm-slim`; dev lokal Node 24 OK.
- `sijagakali-api`: **tanpa dependensi npm baru**. Test pakai `node:test` + `tsx` (`node --import tsx --test`), HTTP pakai `fetch` global, digest pakai `node:crypto`.
- `sijagakali-app`: satu-satunya dependensi baru `hls.js`.
- Topik MQTT tetap `sijagakali/{device_id}/...`; username MQTT device = `device_id`.
- Path Storage snapshot: `{deployment_slug}/{device_id}/{YYYY-MM-DD}/{unix_ts}_{device_id}.jpg`, bucket `cctv-images` (`ENV.SUPABASE_STORAGE_BUCKET_CCTV_IMAGES`).
- Host kamera = kolom yang sudah ada `device_configs.cctv_local_ip` (tanpa migrasi baru).
- Live: hanya sub stream `/Streaming/Channels/102` (H.264). Snapshot: `/ISAPI/Streaming/channels/101/picture`.
- Live player: tidak autoplay, auto-stop **5 menit**.
- Hostname: `api-sijagakali.inspiralabs.id` (sudah ada), `mqtt-sijagakali.inspiralabs.id`, `cctv-sijagakali.inspiralabs.id`, `ota-sijagakali.inspiralabs.id`.
- Alias broker di network `edge`: `sijagakali-mosquitto` → `mqtt://sijagakali-mosquitto:1883`.
- Rahasia **tidak pernah** di-commit: `.env`, pwfile mosquitto, `deploy/mediamtx.yml`.
- Teks UI & log berbahasa Indonesia, mengikuti kode sekitarnya.
- Semua perintah git diawali `rtk` (CLAUDE.md). Pesan commit gaya `feat:`/`fix:`/`docs:` diakhiri baris `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Branch: `sijagakali-api` tetap di `deploy/vps`. Repo lain yang ada di branch default (`sijagakali-app` = `main`, `sijagakali-ota` = `master`, `sijagakali-firmware` = `master`) → buat branch dulu (nama di tiap task).
- Langkah bertanda **[USER]** butuh akses fisik/VPS/akun milik user — executor berhenti dan minta user menjalankan, lalu lanjut dari hasilnya.

## Review Focus

1. Kamera menolak kredensial (password kamera diganti) → snapshot `null`, WA tetap terkirim teks, tidak crash. Dipin di Task 2 (`wrong password rejects`) + Task 3 (`captureSnapshot never throws`).
2. Internet 4G lambat / kamera hang → snapshot dibatasi timeout, dispatch tidak macet selamanya. Dipin di Task 2 (`times out`).
3. Gateway restart/mati saat alarm → reading tetap tersimpan, `notifyGateway` mengembalikan `false` tanpa throw. Dipin di Task 1 (`returns false when gateway is down`).
4. Tab live ditinggal terbuka / pindah halaman → stream berhenti (auto-stop + destroy saat unmount), kuota tidak bocor. Dipin di Task 7 (`auto-stops`, `destroys on unmount`).
5. Device yang dibobol publish ke `command`-nya sendiri / topik device lain → ditolak broker. Dipin di Task 5 (`acl-check.sh`).

---

## File Structure

**sijagakali-api**
- Create `shared/src/notifyGateway.ts` — `parseNotificationEvent`, `notifyGateway` (bus notifikasi via HTTP).
- Create `shared/src/notifyGateway.test.ts`
- Create `shared/src/httpServer.test-util.ts` — server HTTP sementara untuk test.
- Delete `shared/src/notifEmitter.ts`
- Create `shared/src/hikvision.ts` — digest auth + fetch snapshot ISAPI (murni, tanpa `ENV`).
- Create `shared/src/hikvision.test.ts`
- Modify `shared/src/cctvSignedUrl.ts` — tambah `cctvStoragePath`.
- Create `shared/src/cctvSignedUrl.test.ts`
- Create `shared/src/cctvSnapshot.ts` — `captureSnapshot` (fetch + upload, pakai `ENV`).
- Create `shared/src/cctvSnapshot.test.ts`
- Modify `shared/src/index.ts`, `shared/src/env.ts`, `shared/tsconfig.json`, `package.json` (script `test`), `.env.example`
- Modify `data-processing/src/index.ts` — kirim via HTTP, snapshot saat notify.
- Modify `notification-gateway/src/index.ts` — `POST /notify`, hapus listener emitter.
- Modify `mqtt-collector/src/index.ts`, `mqtt-collector/package.json` — pakai `cctvStoragePath`, buang `date-fns`.
- Modify `api/src/routes/cctv.ts` — `POST /api/cctv/:deviceId/snapshot`.
- Modify `docker-compose.yml` — `GATEWAY_URL`, `MQTT_BROKER_URL`, service `mosquitto`, `mediamtx`.
- Create `deploy/mosquitto/mosquitto.conf`, `deploy/mosquitto/acl`, `deploy/mosquitto/acl-check.sh`
- Create `deploy/mediamtx.example.yml`; Modify `.gitignore`
- Create `deploy/cctv-network.md`, `deploy/e2e-checklist.md`

**sijagakali-app** (branch `feat/cctv-hls-player`)
- Create `src/components/HlsPlayer.tsx`, `src/components/HlsPlayer.test.tsx`
- Modify `src/components/CctvPanel.tsx`, `src/components/DeviceCard.tsx`, `src/pages/DeviceSettings.tsx`, `package.json`

**sijagakali-ota** (branch `feat/docker-deploy`)
- Modify `src/mqttClient.ts`; Create `src/mqttClient.test.ts`
- Create `Dockerfile`, `.dockerignore`, `docker-compose.yml`; Modify `.env.example`

**sijagakali-firmware** (branch `feat/vps-broker`) — Modify `src/main.cpp` (URI broker; versi untuk uji OTA).

**esp32-dummy** — Modify `index.js` (`WATER_LEVEL_CM` override).

---

### Task 1: Bus notifikasi lewat HTTP (perbaikan notifikasi otomatis)

**Files:**
- Create: `shared/src/notifyGateway.ts`, `shared/src/notifyGateway.test.ts`, `shared/src/httpServer.test-util.ts`
- Delete: `shared/src/notifEmitter.ts`
- Modify: `shared/src/index.ts:8`, `shared/tsconfig.json`, `package.json` (root scripts), `data-processing/src/index.ts:1-10,226-235`, `notification-gateway/src/index.ts:1-16,139-143,246`, `docker-compose.yml` (service `data-processing`)

**Interfaces:**
- Consumes: `NotificationEvent` dari `shared/src/types.ts`; `processNotification(event)` yang sudah ada di gateway; `ENV.GATEWAY_URL`.
- Produces:
  - `parseNotificationEvent(body: unknown): NotificationEvent | null`
  - `notifyGateway(gatewayUrl: string, event: NotificationEvent, timeoutMs?: number): Promise<boolean>` — tidak pernah throw.
  - `startTestServer(handler: http.RequestListener): Promise<{ url: string; close: () => void }>` (test util, dipakai Task 2).
  - Endpoint gateway `POST /notify` → `202 {ok:true}` / `400`.
  - Script root `npm test`.

- [ ] **Step 1: Siapkan test runner**

Root `package.json`, tambahkan di `"scripts"` (setelah `"build:start"`):

```json
    "test": "node --import tsx --test \"shared/src/**/*.test.ts\""
```

`shared/tsconfig.json` — tambahkan `exclude` agar test tidak ikut ke `dist`:

```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts", "src/**/*.test-util.ts"]
}
```

Create `shared/src/httpServer.test-util.ts`:

```ts
import http from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

/** Server HTTP sementara di 127.0.0.1 port acak, khusus test. */
export async function startTestServer(
  handler: http.RequestListener
): Promise<{ url: string; close: () => void }> {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
```

- [ ] **Step 2: Tulis test yang gagal**

Create `shared/src/notifyGateway.test.ts`:

```ts
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
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../notifyGateway.js'`.

- [ ] **Step 4: Implementasi**

Create `shared/src/notifyGateway.ts`:

```ts
import type { NotificationEvent } from './types.js';

const VALID_STATUS = new Set(['normal', 'waspada', 'siaga', 'bahaya']);

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** Validasi minimal body `POST /notify`; null jika tidak valid. */
export function parseNotificationEvent(body: unknown): NotificationEvent | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!nonEmpty(b.reading_id) || !nonEmpty(b.device_id) || !nonEmpty(b.deployment_slug)) return null;
  if (typeof b.water_status !== 'string' || !VALID_STATUS.has(b.water_status)) return null;
  if (typeof b.water_level_cm !== 'number' || !Number.isFinite(b.water_level_cm)) return null;
  return b as unknown as NotificationEvent;
}

/**
 * Kirim event ke notification-gateway (`POST {gatewayUrl}/notify`).
 * Tidak pernah throw — false bila gateway mati/menolak, agar reading tetap tersimpan.
 */
export async function notifyGateway(
  gatewayUrl: string,
  event: NotificationEvent,
  timeoutMs = 10_000
): Promise<boolean> {
  try {
    const res = await fetch(`${gatewayUrl}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      console.error(`[notifyGateway] gateway membalas HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[notifyGateway] gagal menghubungi gateway:', err instanceof Error ? err.message : String(err));
    return false;
  }
}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `npm test`
Expected: PASS, 5 test.

- [ ] **Step 6: Sambungkan ke service, hapus emitter**

Hapus file `shared/src/notifEmitter.ts`. Di `shared/src/index.ts` ganti baris
`export { notifEmitter } from './notifEmitter.js';` dengan:

```ts
export * from './notifyGateway.js';
```

`data-processing/src/index.ts` — di blok import `@sijagakali/shared` ganti `notifEmitter,` dengan `notifyGateway,`. Lalu ganti:

```ts
    notifEmitter.emit('notify', event);
    console.log(
      `[processing] notif event emitted for device=${resolvedDeviceId} status=${waterStatus}`
    );
```

dengan:

```ts
    const sent = await notifyGateway(ENV.GATEWAY_URL, event);
    console.log(
      `[processing] notif ${sent ? 'dikirim ke gateway' : 'GAGAL dikirim ke gateway'} — device=${resolvedDeviceId} status=${waterStatus}`
    );
```

`notification-gateway/src/index.ts` — di import `@sijagakali/shared` hapus `notifEmitter,` dan tambahkan `parseNotificationEvent,`. Hapus blok:

```ts
notifEmitter.on('notify', (event: NotificationEvent) => {
  processNotification(event).catch((err) => {
    console.error('[notification-gateway] processNotification unhandled:', err);
  });
});
```

Tambahkan route sebelum `gatewayApp.get('/health', ...)`:

```ts
gatewayApp.post('/notify', async (req, reply) => {
  const event = parseNotificationEvent(req.body);
  if (!event) return reply.code(400).send({ error: 'NotificationEvent tidak valid' });
  processNotification(event).catch((err) => {
    console.error('[notification-gateway] processNotification unhandled:', err);
  });
  return reply.code(202).send({ ok: true });
});
```

`docker-compose.yml` — service `data-processing`, tambahkan:

```yaml
    environment:
      GATEWAY_URL: http://notification-gateway:3101
```

- [ ] **Step 7: Build & verifikasi tidak ada sisa emitter**

Run: `npm run build`
Expected: sukses tanpa error TS.

Run: `rtk grep -rn notifEmitter shared/src data-processing/src notification-gateway/src api/src`
Expected: tidak ada hasil.

Verifikasi manual route (gateway butuh `.env` Supabase; WA boleh belum login):
Run (terminal 1): `npm -w @sijagakali/notification-gateway run dev`
Run (terminal 2): `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3101/notify -H "Content-Type: application/json" -d "{\"reading_id\":\"x\"}"`
Expected: `400`.

- [ ] **Step 8: Commit**

```bash
rtk git add package.json shared data-processing/src notification-gateway/src docker-compose.yml
rtk git commit -m "fix: send notifications to gateway over HTTP instead of in-process EventEmitter

data-processing and notification-gateway run as separate processes/containers,
so notifEmitter events never reached the gateway.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Klien snapshot Hikvision (digest auth)

**Files:**
- Create: `shared/src/hikvision.ts`, `shared/src/hikvision.test.ts`

**Interfaces:**
- Consumes: `startTestServer` dari `shared/src/httpServer.test-util.ts` (Task 1).
- Produces:
  - `HIKVISION_SNAPSHOT_URI = '/ISAPI/Streaming/channels/101/picture'`
  - `parseDigestParams(header: string): Record<string, string>`
  - `buildDigestAuth(opts: { method: string; uri: string; username: string; password: string; challenge: string; nc?: string; cnonce?: string }): string`
  - `fetchHikvisionSnapshot(host: string, creds: { username: string; password: string; timeoutMs: number }): Promise<Buffer>` — throw bila gagal.

- [ ] **Step 1: Tulis test yang gagal**

Create `shared/src/hikvision.test.ts`:

```ts
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
function fakeCamera(password: string, contentType = 'image/jpeg') {
  const realm = 'IP Camera(C1234)';
  const nonce = 'abc123nonce';
  return startTestServer((req, res) => {
    const auth = req.headers.authorization;
    if (auth) {
      const p = parseDigestParams(auth);
      const ha1 = md5(`${p.username}:${realm}:${password}`);
      const ha2 = md5(`GET:${p.uri}`);
      const expected = md5(`${ha1}:${nonce}:${p.nc}:${p.cnonce}:${p.qop}:${ha2}`);
      if (p.response === expected && p.uri === HIKVISION_SNAPSHOT_URI) {
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
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../hikvision.js'`.

- [ ] **Step 3: Implementasi**

Create `shared/src/hikvision.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

/** Snapshot JPEG main stream (channel 101) via ISAPI. */
export const HIKVISION_SNAPSHOT_URI = '/ISAPI/Streaming/channels/101/picture';

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

/** Parse `key="value"` / `key=value` dari header Digest (WWW-Authenticate maupun Authorization). */
export function parseDigestParams(header: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of header.replace(/^Digest\s+/i, '').matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)) {
    out[m[1].toLowerCase()] = m[2] ?? m[3];
  }
  return out;
}

// ponytail: MD5 + qop=auth saja (default Hikvision); tambah SHA-256 bila kamera lain memintanya.
export function buildDigestAuth(opts: {
  method: string;
  uri: string;
  username: string;
  password: string;
  challenge: string;
  nc?: string;
  cnonce?: string;
}): string {
  const c = parseDigestParams(opts.challenge);
  const nc = opts.nc ?? '00000001';
  const cnonce = opts.cnonce ?? randomBytes(8).toString('hex');
  const qop = c.qop?.split(',').map((s) => s.trim()).includes('auth') ? 'auth' : undefined;
  const ha1 = md5(`${opts.username}:${c.realm}:${opts.password}`);
  const ha2 = md5(`${opts.method}:${opts.uri}`);
  const response = qop
    ? md5(`${ha1}:${c.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${c.nonce}:${ha2}`);

  const parts = [
    `username="${opts.username}"`,
    `realm="${c.realm}"`,
    `nonce="${c.nonce}"`,
    `uri="${opts.uri}"`,
    `response="${response}"`,
  ];
  if (c.opaque) parts.push(`opaque="${c.opaque}"`);
  if (c.algorithm) parts.push(`algorithm=${c.algorithm}`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  return `Digest ${parts.join(', ')}`;
}

/** Ambil snapshot JPEG dari kamera Hikvision. Throw bila auth/HTTP/content-type/timeout gagal. */
export async function fetchHikvisionSnapshot(
  host: string,
  creds: { username: string; password: string; timeoutMs: number }
): Promise<Buffer> {
  const url = `http://${host}${HIKVISION_SNAPSHOT_URI}`;
  const signal = AbortSignal.timeout(creds.timeoutMs);

  let res = await fetch(url, { signal });
  if (res.status === 401) {
    const challenge = res.headers.get('www-authenticate') ?? '';
    await res.arrayBuffer();
    if (!/^digest/i.test(challenge)) {
      throw new Error(`kamera meminta auth non-digest: ${challenge || '(kosong)'}`);
    }
    res = await fetch(url, {
      signal,
      headers: {
        Authorization: buildDigestAuth({
          method: 'GET',
          uri: HIKVISION_SNAPSHOT_URI,
          username: creds.username,
          password: creds.password,
          challenge,
        }),
      },
    });
  }

  if (!res.ok) throw new Error(`kamera membalas HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!type.toLowerCase().includes('image/jpeg')) {
    throw new Error(`content-type bukan image/jpeg: ${type || '(kosong)'}`);
  }
  return Buffer.from(await res.arrayBuffer());
}
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm test`
Expected: PASS (5 test Task 1 + 5 test Task 2).

- [ ] **Step 5: Commit**

```bash
rtk git add shared/src/hikvision.ts shared/src/hikvision.test.ts
rtk git commit -m "feat: add Hikvision ISAPI snapshot client with digest auth

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `captureSnapshot` + path Storage bersama

**Files:**
- Modify: `shared/src/cctvSignedUrl.ts` (tambah `cctvStoragePath` di akhir file), `shared/src/env.ts` (objek `ENV`), `shared/src/index.ts`, `.env.example`, `mqtt-collector/src/index.ts:1-9,96-101`, `mqtt-collector/package.json`
- Create: `shared/src/cctvSignedUrl.test.ts`, `shared/src/cctvSnapshot.ts`, `shared/src/cctvSnapshot.test.ts`

**Interfaces:**
- Consumes: `fetchHikvisionSnapshot` (Task 2), `getSupabaseStorage()`, `ENV`.
- Produces:
  - `cctvStoragePath(deploymentSlug: string, deviceId: string, now?: Date): string`
  - `captureSnapshot(opts: { host: string; deploymentSlug: string; deviceId: string }): Promise<string | null>` — tidak pernah throw.
  - `ENV.CCTV_USERNAME: string`, `ENV.CCTV_PASSWORD: string`, `ENV.CCTV_SNAPSHOT_TIMEOUT_MS: number`

- [ ] **Step 1: Tulis test yang gagal**

Create `shared/src/cctvSignedUrl.test.ts`:

```ts
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
```

Create `shared/src/cctvSnapshot.test.ts` (env diisi sebelum import karena `env.ts` mewajibkan Supabase):

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL ??= 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-key';
process.env.CCTV_SNAPSHOT_TIMEOUT_MS = '500';

test('captureSnapshot never throws and returns null when camera is unreachable', async () => {
  const { captureSnapshot } = await import('./cctvSnapshot.js');
  const result = await captureSnapshot({ host: '127.0.0.1:1', deploymentSlug: 's', deviceId: 'node-001' });
  assert.equal(result, null);
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npm test`
Expected: FAIL — `cctvStoragePath` bukan export / modul `cctvSnapshot.js` tidak ditemukan.

- [ ] **Step 3: Implementasi**

Tambahkan di akhir `shared/src/cctvSignedUrl.ts`:

```ts
/** Path objek snapshot CCTV: `{slug}/{deviceId}/{YYYY-MM-DD}/{unix_ts}_{deviceId}.jpg` (tanggal waktu lokal proses). */
export function cctvStoragePath(deploymentSlug: string, deviceId: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  return `${deploymentSlug}/${deviceId}/${day}/${Math.floor(now.getTime() / 1000)}_${deviceId}.jpg`;
}
```

`shared/src/env.ts` — tambahkan di dalam objek `ENV` (sebelum `};` penutup):

```ts
  /** Kredensial kamera Hikvision (user khusus hak Live View). Dipakai snapshot ISAPI. */
  CCTV_USERNAME: optional_env('CCTV_USERNAME'),
  CCTV_PASSWORD: optional_env('CCTV_PASSWORD'),
  /** Batas waktu ambil snapshot (ms) — internet lokasi 4G bisa lambat. */
  CCTV_SNAPSHOT_TIMEOUT_MS: optional_env_number('CCTV_SNAPSHOT_TIMEOUT_MS', 8_000),
```

Create `shared/src/cctvSnapshot.ts`:

```ts
import { ENV } from './env.js';
import { getSupabaseStorage } from './supabaseClient.js';
import { fetchHikvisionSnapshot } from './hikvision.js';
import { cctvStoragePath } from './cctvSignedUrl.js';

/**
 * Ambil snapshot kamera → upload ke bucket CCTV.
 * Path Storage bila sukses; null bila gagal di langkah mana pun (tidak throw —
 * kamera mati tidak boleh menahan notifikasi).
 */
export async function captureSnapshot(opts: {
  host: string;
  deploymentSlug: string;
  deviceId: string;
}): Promise<string | null> {
  try {
    const jpeg = await fetchHikvisionSnapshot(opts.host, {
      username: ENV.CCTV_USERNAME,
      password: ENV.CCTV_PASSWORD,
      timeoutMs: ENV.CCTV_SNAPSHOT_TIMEOUT_MS,
    });
    const path = cctvStoragePath(opts.deploymentSlug, opts.deviceId);
    const { error } = await getSupabaseStorage()
      .storage.from(ENV.SUPABASE_STORAGE_BUCKET_CCTV_IMAGES)
      .upload(path, jpeg, { contentType: 'image/jpeg', upsert: false });
    if (error) throw new Error(`upload Storage: ${error.message}`);
    return path;
  } catch (err) {
    console.error(
      `[cctv_snapshot_failed] device=${opts.deviceId} host=${opts.host}:`,
      err instanceof Error ? err.message : String(err)
    );
    return null;
  }
}
```

`shared/src/index.ts` — tambahkan:

```ts
export * from './cctvSnapshot.js';
```

`.env.example` — tambahkan di akhir:

```
# CCTV Hikvision (snapshot ISAPI lewat Tailscale ke IP di device_configs.cctv_local_ip)
CCTV_USERNAME=
CCTV_PASSWORD=
CCTV_SNAPSHOT_TIMEOUT_MS=8000
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `npm test`
Expected: PASS (semua test, termasuk 3 test baru).

- [ ] **Step 5: Collector pakai `cctvStoragePath`, buang `date-fns`**

`mqtt-collector/src/index.ts` — hapus `import { format } from 'date-fns';`, tambahkan `cctvStoragePath,` ke import `@sijagakali/shared` (blok import pertama). Ganti:

```ts
  const dateFolder = format(new Date(), 'yyyy-MM-dd');
  const ts = Math.floor(Date.now() / 1000);
  const filePath = `${defaultDeployment}/${deviceId}/${dateFolder}/${ts}_${deviceId}.jpg`;
```

dengan:

```ts
  const filePath = cctvStoragePath(defaultDeployment, deviceId);
```

Run: `npm uninstall -w @sijagakali/mqtt-collector date-fns`
Run: `npm run build`
Expected: sukses.

- [ ] **Step 6: Commit**

```bash
rtk git add shared mqtt-collector package-lock.json .env.example
rtk git commit -m "feat: add captureSnapshot (Hikvision -> Supabase Storage) and shared CCTV storage path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Snapshot saat notifikasi + endpoint snapshot manual

**Files:**
- Modify: `data-processing/src/index.ts` (`DeviceConfigRow`, select di `getDeviceConfig`, blok `if (notify)`)
- Modify: `api/src/routes/cctv.ts`

**Interfaces:**
- Consumes: `captureSnapshot` (Task 3), `notifyGateway` (Task 1), kolom `device_configs.cctv_local_ip`.
- Produces: `POST /api/cctv/:deviceId/snapshot` (admin, body opsional `{ deployment_slug?: string }`) → `200 { path: string, signedUrl: string }` | `404` | `502` | `500`. Dipakai Task 7.

- [ ] **Step 1: data-processing ambil snapshot saat notify**

`data-processing/src/index.ts`:

1. Import: tambahkan `captureSnapshot,` ke import `@sijagakali/shared`.
2. Tipe `DeviceConfigRow`: tambahkan field `cctv_local_ip: string | null;`.
3. String select di `getDeviceConfig`: tambahkan `,cctv_local_ip` di akhir (setelah `notify_cooldown_bahaya_sec`).
4. Di dalam `if (notify) {`, tepat setelah `const dep = await getDeploymentNotifyRow(slug);`, tambahkan:

```ts
    // Kamera IP (Hikvision via Tailscale): snapshot hanya saat notifikasi — hemat kuota 4G lokasi.
    let cctvPath = cctvRow?.cctv_storage_path ?? null;
    if (!cctvPath && config.cctv_local_ip) {
      cctvPath = await captureSnapshot({
        host: config.cctv_local_ip,
        deploymentSlug: slug,
        deviceId: resolvedDeviceId,
      });
      if (cctvPath) {
        const { error: camErr } = await supabase
          .from('sensor_readings')
          .update({ cctv_image_path: cctvPath, cctv_captured_at: new Date().toISOString() })
          .eq('id', reading.id);
        if (camErr) console.error('[processing] UPDATE cctv_image_path gagal:', camErr.message);
      }
    }
```

5. Di objek `event`, ganti `cctv_image_path: cctvRow?.cctv_storage_path ?? null,` dengan `cctv_image_path: cctvPath,`.

- [ ] **Step 2: Endpoint snapshot manual**

`api/src/routes/cctv.ts` — tambahkan import di atas:

```ts
import { ENV, captureSnapshot } from '@sijagakali/shared';
```

ubah destrukturisasi menjadi `const { supabase, supabaseStorage, bucket, requireAdmin } = deps;`, lalu tambahkan sebelum penutup fungsi:

```ts
  app.post<{ Params: { deviceId: string }; Body: { deployment_slug?: string } | undefined }>(
    '/api/cctv/:deviceId/snapshot',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const slug = req.body?.deployment_slug ?? ENV.DEFAULT_DEPLOYMENT_SLUG;
      const { deviceId } = req.params;

      const { data, error } = await supabase
        .from('device_configs')
        .select('cctv_local_ip')
        .eq('deployment_slug', slug)
        .eq('device_id', deviceId)
        .maybeSingle();
      if (error) return reply.code(500).send({ error: error.message });

      const host = (data?.cctv_local_ip as string | null | undefined)?.trim();
      if (!host) return reply.code(404).send({ error: 'Perangkat belum punya IP kamera (cctv_local_ip)' });

      const path = await captureSnapshot({ host, deploymentSlug: slug, deviceId });
      if (!path) return reply.code(502).send({ error: 'Gagal mengambil snapshot dari kamera' });

      const { data: signed, error: signErr } = await supabaseStorage.storage
        .from(bucket)
        .createSignedUrl(path, 3600);
      if (signErr) return reply.code(500).send({ error: signErr.message });

      return reply.send({ path, signedUrl: signed.signedUrl });
    },
  );
```

- [ ] **Step 3: Build + test**

Run: `npm run build && npm test`
Expected: sukses, semua test PASS.

- [ ] **Step 4: Verifikasi manual 404 (tanpa kamera)**

Run (terminal 1): `npm -w @sijagakali/api run dev`
Run (terminal 2): login admin di dashboard lokal → salin access token dari DevTools (`localStorage`, key `sb-*-auth-token` → `access_token`), lalu:
`curl -s -X POST http://127.0.0.1:3100/api/cctv/node-001/snapshot -H "Authorization: Bearer <TOKEN>"`
Expected: `{"error":"Perangkat belum punya IP kamera (cctv_local_ip)"}` bila `cctv_local_ip` node-001 kosong, atau `{"error":"Gagal mengambil snapshot dari kamera"}` bila terisi tapi kamera tak terjangkau dari laptop. Keduanya membuktikan route + guard bekerja; jalur sukses diuji di Task 10.

- [ ] **Step 5: Commit**

```bash
rtk git add data-processing/src/index.ts api/src/routes/cctv.ts
rtk git commit -m "feat: capture Hikvision snapshot on notify and add manual snapshot endpoint

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Broker mosquitto di docker compose (+ ACL per arah)

**Files:**
- Create: `deploy/mosquitto/mosquitto.conf`, `deploy/mosquitto/acl`, `deploy/mosquitto/acl-check.sh`
- Modify: `docker-compose.yml` (service baru `mosquitto`, volume `mosquitto-data`, `MQTT_BROKER_URL` di `api` & `mqtt-collector`), `.env.example`

**Interfaces:**
- Produces: broker `mqtt://sijagakali-mosquitto:1883` (internal, network `edge`), `wss://mqtt-sijagakali.inspiralabs.id/mqtt` (publik via Traefik → 9001). User `sijagakali-backend` + satu user per device (`node-001`, ...). Dipakai Task 8, 9, 10.

- [ ] **Step 1: Tulis konfigurasi broker**

Create `deploy/mosquitto/mosquitto.conf`:

```
# Broker SiJagaKali di VPS (docker compose).
# 1883: MQTT plain, hanya jaringan docker (api, mqtt-collector, sijagakali-ota).
# 9001: MQTT over WebSocket, diekspos Traefik sebagai wss://mqtt-sijagakali.inspiralabs.id (TLS di Traefik).
per_listener_settings false
allow_anonymous false
password_file /mosquitto/data/pwfile
acl_file /mosquitto/config/acl

persistence true
persistence_location /mosquitto/data/
log_dest stdout
log_type error
log_type warning
log_type notice

listener 1883
protocol mqtt

listener 9001
protocol websockets
```

Create `deploy/mosquitto/acl`:

```
# Backend (mqtt-collector, api, sijagakali-ota) butuh seluruh pohon topik.
user sijagakali-backend
topic readwrite sijagakali/#

# Device: username = device_id. Hanya kirim data/ack, hanya terima command/config miliknya.
pattern write sijagakali/%u/sensor/#
pattern write sijagakali/%u/cctv/#
pattern write sijagakali/%u/command/ack
pattern read sijagakali/%u/command
pattern read sijagakali/%u/config/#
```

- [ ] **Step 2: Tulis cek ACL (test yang gagal sebelum broker ada)**

Create `deploy/mosquitto/acl-check.sh`:

```sh
#!/bin/sh
# Cek auth + ACL broker. Jalankan:
#   docker compose exec -e BACKEND_PASS=... -e DEVICE_PASS=... mosquitto sh /mosquitto/config/acl-check.sh
# Butuh user sijagakali-backend dan node-001 di pwfile. Exit 0 = lulus.
set -eu
H=127.0.0.1
OUT=/tmp/acl-check.out

mosquitto_sub -h $H -u sijagakali-backend -P "$BACKEND_PASS" -t 'sijagakali/#' -v -W 4 > "$OUT" 2>/dev/null &
SUB=$!
sleep 1

pub() { mosquitto_pub -h $H -u node-001 -P "$DEVICE_PASS" -q 1 -t "$1" -m "$2" 2>/dev/null || true; }
pub sijagakali/node-001/sensor/data allowed
pub sijagakali/node-002/sensor/data denied-other-device
pub sijagakali/node-001/command denied-own-command

if mosquitto_pub -h $H -u node-001 -P wrong-password -t sijagakali/node-001/sensor/data -m x 2>/dev/null; then
  echo "FAIL: password salah diterima"; exit 1
fi

wait $SUB || true
grep -q 'sijagakali/node-001/sensor/data allowed' "$OUT" || { echo "FAIL: publish sah tidak sampai"; cat "$OUT"; exit 1; }
if grep -q denied "$OUT"; then echo "FAIL: publish terlarang lolos"; cat "$OUT"; exit 1; fi
echo "ACL OK"
```

- [ ] **Step 3: Tambahkan service ke compose**

`docker-compose.yml` — tambahkan service (di bawah `notification-gateway`, sejajar):

```yaml
  mosquitto:
    image: eclipse-mosquitto:2
    restart: unless-stopped
    networks:
      edge:
        # network `edge` dipakai bersama project lain — alias unik agar tidak bentrok
        aliases: [sijagakali-mosquitto]
    volumes:
      - ./deploy/mosquitto:/mosquitto/config:ro
      - mosquitto-data:/mosquitto/data
    expose: ["1883", "9001"]
    labels:
      - traefik.enable=true
      - traefik.http.routers.sijagakali-mqtt.rule=Host(`mqtt-sijagakali.inspiralabs.id`)
      - traefik.http.services.sijagakali-mqtt.loadbalancer.server.port=9001
```

Di blok `volumes:` paling bawah tambahkan `mosquitto-data:`. Di `environment` service `api` tambahkan `MQTT_BROKER_URL: mqtt://sijagakali-mosquitto:1883`. Service `mqtt-collector` tambahkan:

```yaml
    environment:
      MQTT_BROKER_URL: mqtt://sijagakali-mosquitto:1883
```

`.env.example` — ganti baris `MQTT_USERNAME=` dengan `MQTT_USERNAME=sijagakali-backend` dan tambahkan komentar di atas `MQTT_BROKER_URL`:

```
# Docker compose meng-override ini ke mqtt://sijagakali-mosquitto:1883
```

- [ ] **Step 4: Jalankan broker lokal dan cek ACL**

```bash
docker network create edge 2>/dev/null || true
docker compose run --rm --entrypoint mosquitto_passwd mosquitto -c -b /mosquitto/data/pwfile sijagakali-backend backend-test
docker compose run --rm --entrypoint mosquitto_passwd mosquitto -b /mosquitto/data/pwfile node-001 device-test
docker compose up -d mosquitto
docker compose logs mosquitto
```

Expected log: `Opening ipv4 listen socket on port 1883` dan `Opening websockets listen socket on port 9001`, tanpa `Error`.

Run: `docker compose exec -e BACKEND_PASS=backend-test -e DEVICE_PASS=device-test mosquitto sh /mosquitto/config/acl-check.sh`
Expected: `ACL OK`.

Bila broker menolak pwfile karena owner/permission, jalankan `docker compose restart mosquitto` (entrypoint image meng-`chown` `/mosquitto` saat start) lalu ulangi.

Bersihkan: `docker compose down mosquitto && docker volume rm sijagakali-api_mosquitto-data` (nama volume cek dengan `docker volume ls`).

- [ ] **Step 5: Commit**

```bash
rtk git add deploy/mosquitto docker-compose.yml .env.example
rtk git commit -m "feat: add mosquitto broker to VPS compose with per-direction device ACL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: MediaMTX (live HLS on-demand) + panduan jaringan kamera

**Files:**
- Create: `deploy/mediamtx.example.yml`, `deploy/cctv-network.md`
- Modify: `docker-compose.yml` (service `mediamtx`), `.gitignore`

**Interfaces:**
- Consumes: `device_configs.cctv_local_ip`, `CCTV_USERNAME`/`CCTV_PASSWORD` (user kamera yang sama).
- Produces: `https://cctv-sijagakali.inspiralabs.id/cam-{device_id}/index.m3u8` — nilai `stream_playback_url` device (dipakai Task 7 & 10).

- [ ] **Step 1: Contoh konfigurasi MediaMTX**

Create `deploy/mediamtx.example.yml`:

```yaml
# Salin ke deploy/mediamtx.yml di VPS (file itu di-gitignore — berisi password kamera).
# Hanya HLS yang aktif: tidak ada yang bisa publish ke server ini.
logLevel: info
api: no
metrics: no
pprof: no
playback: no
rtsp: no
rtmp: no
webrtc: no
srt: no

hls: yes
hlsAddress: :8888
hlsVariant: mpegts
# Isi dengan origin dashboard (nilai ALLOWED_ORIGIN di .env), mis. https://sijagakali.example.id
hlsAllowOrigins: ['https://GANTI-DENGAN-ORIGIN-DASHBOARD']

# Live publik (keputusan desain): siapa pun boleh read, tidak ada publish.
authInternalUsers:
  - user: any
    pass:
    ips: []
    permissions:
      - action: read
        path:

paths:
  # Satu entri per kamera. Nama path = cam-{device_id}.
  # Sub stream 102 (H.264, ±512 kbps) — main stream terlalu boros untuk kuota 4G.
  cam-node-001:
    source: rtsp://CCTV_USER:CCTV_PASS@192.168.1.64:554/Streaming/Channels/102
    rtspTransport: tcp
    sourceOnDemand: yes
    sourceOnDemandCloseAfter: 10s
```

`.gitignore` — tambahkan:

```
# Konfigurasi MediaMTX asli (berisi kredensial kamera)
deploy/mediamtx.yml
```

- [ ] **Step 2: Service compose**

`docker-compose.yml` — tambahkan service:

```yaml
  mediamtx:
    image: bluenviron/mediamtx:1
    restart: unless-stopped
    networks: [edge]
    volumes:
      - ./deploy/mediamtx.yml:/mediamtx.yml:ro
    expose: ["8888"]
    labels:
      - traefik.enable=true
      - traefik.http.routers.sijagakali-cctv.rule=Host(`cctv-sijagakali.inspiralabs.id`)
      - traefik.http.services.sijagakali-cctv.loadbalancer.server.port=8888
```

- [ ] **Step 3: Cek konfigurasi termuat (lokal)**

```bash
cp deploy/mediamtx.example.yml deploy/mediamtx.yml
docker compose up -d mediamtx
docker compose logs mediamtx
```

Expected: `[HLS] listener opened on :8888`, tidak ada `ERR` tentang konfigurasi. (Source kamera belum terjangkau dari laptop — itu normal; on-demand baru mencoba saat ada penonton.)

Run: `docker run --rm --network edge curlimages/curl -s -o /dev/null -w "%{http_code}\n" --max-time 20 http://mediamtx:8888/cam-node-001/index.m3u8`
Expected: kode HTTP `404` atau `500`-an (source gagal) — **bukan** koneksi ditolak. Itu membuktikan HLS listener & path terdaftar.

Bersihkan: `docker compose down mediamtx`. Jangan commit `deploy/mediamtx.yml` (cek `rtk git status` — tidak boleh muncul).

- [ ] **Step 4: Panduan jaringan & kamera**

Create `deploy/cctv-network.md`:

````markdown
# Jaringan CCTV: Hikvision → Raspberry Pi (Tailscale) → VPS

Kamera ada di LAN router 4G (CGNAT, tanpa IP publik). Raspberry Pi di LAN yang sama
menjadi **Tailscale subnet router**; VPS ikut tailnet dan bisa menjangkau IP LAN kamera
(snapshot ISAPI + RTSP untuk MediaMTX). Tidak ada port yang dibuka di router lokasi.

## 1. Kamera Hikvision DS-2CD1041G2-LIUF (web admin kamera)

1. **IP statis**: Configuration → Network → Basic Settings → TCP/IP → matikan DHCP,
   isi IP tetap (mis. `192.168.1.64`), gateway = IP router 4G. Atau reservasi DHCP di router.
2. **Sub stream** (dipakai live): Configuration → Video/Audio → Video → Stream Type
   **Sub Stream** → Video Encoding **H.264** (bukan H.265 — browser tidak bisa memutar H.265),
   Resolution 640×360 atau 640×480, Bitrate Type **Constant**, Max Bitrate **512 Kbps**,
   Frame Rate 15.
3. **User khusus**: System → User Management → Add → level **User**, hak **Remote: Live View**
   saja. Username/password ini = `CCTV_USERNAME`/`CCTV_PASSWORD` di `.env` VPS dan di
   `deploy/mediamtx.yml`.
4. **Auth**: System → Security → Authentication → WEB Authentication **digest**
   (default), RTSP Authentication **digest**.
5. Pastikan ISAPI aktif: Network → Advanced → Integration Protocol (bila ada opsi
   "Enable ISAPI"/"Hikvision-CGI", aktifkan).
6. **Timestamp di gambar (OSD)**: Configuration → Image → OSD Settings → centang
   *Display Date* (format 24 jam) dan isi *Camera Name* (mis. "Kali Bojong Kulur").
   Tanggal/jam tercetak di video live **dan** snapshot — tanpa kode.
7. **Jam akurat**: Configuration → System → System Settings → Time Settings →
   **NTP** (`pool.ntp.org`), zona waktu **GMT+07:00**.

Uji dari laptop di WiFi lokasi:
```bash
curl --digest -u USER:PASS -o snap.jpg http://192.168.1.64/ISAPI/Streaming/channels/101/picture
```
`snap.jpg` harus berupa foto kamera.

## 2. Raspberry Pi (lokasi)

Perangkat: **Raspberry Pi 3 Model B+** (cukup — hanya meneruskan jaringan), microSD
**SanDisk High Endurance / Samsung PRO Endurance 32 GB** (kartu biasa cepat rusak di
perangkat 24 jam), adaptor **5V ≥2.5A micro-USB** (adaptor lemah → undervoltage → SD
korup), kabel LAN ke port TL-MR100, casing berventilasi.

OS: **Raspberry Pi OS Lite (64-bit)** via Raspberry Pi Imager (aktifkan SSH di
pengaturan Imager).

```bash
curl -fsSL https://tailscale.com/install.sh | sh
echo 'net.ipv4.ip_forward = 1' | sudo tee /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
sudo tailscale up --advertise-routes=192.168.1.0/24 --hostname=sijagakali-pi-node-001 --ssh

# Kurangi tulisan ke SD: log di RAM
sudo sed -i 's/^#\?Storage=.*/Storage=volatile/' /etc/systemd/journald.conf
sudo systemctl restart systemd-journald
# Update keamanan otomatis
sudo apt-get install -y unattended-upgrades
```

`--ssh` = Tailscale SSH: Pi bisa dikelola dari laptop/VPS mana pun di tailnet tanpa
membuka port di router.

Sesuaikan `192.168.1.0/24` dengan subnet LAN router 4G. Lalu di
https://login.tailscale.com/admin/machines:
- Pi → **Edit route settings** → setujui `192.168.1.0/24`.
- Pi dan VPS → **Disable key expiry** (agar tidak putus tiap 180 hari).

## 3. VPS (host, bukan container)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --accept-routes --hostname=sijagakali-vps
ping -c 3 192.168.1.64
curl --digest -u USER:PASS -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  http://192.168.1.64/ISAPI/Streaming/channels/101/picture   # harus: 200 image/jpeg
```

Container docker belum tentu bisa lewat tailnet (sumber paket = IP bridge docker).
Tambahkan NAT untuk subnet network `edge`:

```bash
EDGE_SUBNET=$(docker network inspect edge -f '{{(index .IPAM.Config 0).Subnet}}')
sudo iptables -t nat -A POSTROUTING -s "$EDGE_SUBNET" -o tailscale0 -j MASQUERADE
sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
```

**Verifikasi wajib** (dari dalam container di network `edge`):
```bash
docker run --rm --network edge curlimages/curl --digest -u USER:PASS -s -o /dev/null \
  -w '%{http_code} %{content_type}\n' http://192.168.1.64/ISAPI/Streaming/channels/101/picture
```
Harus `200 image/jpeg`. Bila timeout: cek `ip route show table 52 | grep 192.168.1`
(route tailnet ada?), `sudo iptables -t nat -S POSTROUTING` (aturan MASQUERADE ada?).

## 4. Isi data device (dashboard admin → Pengaturan Perangkat → CCTV)

- IP kamera di LAN lapangan: `192.168.1.64`
- URL streaming: `https://cctv-sijagakali.inspiralabs.id/cam-node-001/index.m3u8`

## Kuota

Live ±230 MB/jam (512 kbps). Tanpa penonton: 0. Snapshot ±400 KB per notifikasi.
Player dashboard berhenti otomatis setelah 5 menit.
````

- [ ] **Step 5: Commit**

```bash
rtk git add deploy/mediamtx.example.yml deploy/cctv-network.md docker-compose.yml .gitignore
rtk git commit -m "feat: add MediaMTX on-demand HLS for Hikvision live view and camera network guide

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Dashboard — player HLS hemat kuota + tombol snapshot admin (`sijagakali-app`)

Kerjakan di `../sijagakali-app`. Mulai dengan `rtk git checkout -b feat/cctv-hls-player`.

**Files:**
- Create: `src/components/HlsPlayer.tsx`, `src/components/HlsPlayer.test.tsx`
- Modify: `package.json` (dep `hls.js`), `src/components/CctvPanel.tsx` (`renderLiveBody`), `src/components/DeviceCard.tsx` (`CctvLiveStream`), `src/pages/DeviceSettings.tsx` (kartu CCTV)
- Modify (dari Task 11): `src/lib/types.ts` (`Device.snapshotIntervalMin`), `src/lib/sijagakali/fetchDashboard.ts` (foto terbaru dari `device_configs`), `src/lib/liveDataContext.tsx` (foto tidak ditimpa null + realtime UPDATE `device_configs`)

**Interfaces:**
- Consumes: `POST {VITE_SIJAGAKALIAPI_URL}/api/cctv/:deviceId/snapshot` → `{ path, signedUrl }` (Task 4); `device.cctvUrl` (= `stream_playback_url`).
- Produces: `HlsPlayer({ src: string; poster?: string | null; className?: string })`, `MAX_WATCH_MS = 300000`.

- [ ] **Step 1: Pasang dependensi**

Run: `npm install hls.js`

- [ ] **Step 2: Tulis test yang gagal**

Create `src/components/HlsPlayer.test.tsx`:

```tsx
import { render, screen, fireEvent, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const hls = vi.hoisted(() => ({ instances: [] as Array<Record<string, ReturnType<typeof vi.fn>>> }));

vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported = () => true;
    static Events = { ERROR: 'hlsError' };
    loadSource = vi.fn();
    attachMedia = vi.fn();
    on = vi.fn();
    destroy = vi.fn();
    constructor() {
      hls.instances.push(this as unknown as Record<string, ReturnType<typeof vi.fn>>);
    }
  }
  return { default: FakeHls };
});

import { HlsPlayer, MAX_WATCH_MS } from './HlsPlayer';

const SRC = 'https://cctv-sijagakali.inspiralabs.id/cam-node-001/index.m3u8';

describe('HlsPlayer', () => {
  beforeEach(() => {
    hls.instances.length = 0;
    vi.useFakeTimers();
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('does not load the stream until the user presses play', () => {
    render(<HlsPlayer src={SRC} />);
    expect(screen.getByRole('button', { name: /putar live/i })).toBeInTheDocument();
    expect(hls.instances).toHaveLength(0);
  });

  it('loads the stream on play', () => {
    render(<HlsPlayer src={SRC} />);
    fireEvent.click(screen.getByRole('button', { name: /putar live/i }));
    expect(hls.instances).toHaveLength(1);
    expect(hls.instances[0].loadSource).toHaveBeenCalledWith(SRC);
  });

  it('auto-stops after MAX_WATCH_MS and offers to continue', () => {
    render(<HlsPlayer src={SRC} />);
    fireEvent.click(screen.getByRole('button', { name: /putar live/i }));
    act(() => {
      vi.advanceTimersByTime(MAX_WATCH_MS);
    });
    expect(hls.instances[0].destroy).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /lanjut menonton/i })).toBeInTheDocument();
  });

  it('destroys the stream on unmount', () => {
    const { unmount } = render(<HlsPlayer src={SRC} />);
    fireEvent.click(screen.getByRole('button', { name: /putar live/i }));
    unmount();
    expect(hls.instances[0].destroy).toHaveBeenCalled();
  });

  it('shows "Kamera offline" on a fatal HLS error', () => {
    render(<HlsPlayer src={SRC} />);
    fireEvent.click(screen.getByRole('button', { name: /putar live/i }));
    const onError = hls.instances[0].on.mock.calls[0][1] as (e: unknown, d: { fatal: boolean }) => void;
    act(() => onError('hlsError', { fatal: true }));
    expect(screen.getByText(/kamera offline/i)).toBeInTheDocument();
    expect(hls.instances[0].destroy).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `rtk vitest run src/components/HlsPlayer.test.tsx`
Expected: FAIL — `Failed to resolve import "./HlsPlayer"`.

- [ ] **Step 4: Implementasi**

Create `src/components/HlsPlayer.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Play, VideoOff } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Batas tonton per klik — tab yang lupa ditutup tidak boleh menghabiskan kuota 4G lokasi. */
export const MAX_WATCH_MS = 5 * 60_000;

type PlayerState = 'idle' | 'playing' | 'stopped' | 'error';

interface HlsPlayerProps {
  src: string;
  poster?: string | null;
  className?: string;
}

/** Live HLS (MediaMTX). Tidak autoplay; stream ditutup saat berhenti/unmount agar kamera berhenti ditarik. */
export function HlsPlayer({ src, poster, className }: HlsPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<PlayerState>('idle');

  useEffect(() => {
    if (state !== 'playing') return;
    const video = videoRef.current;
    if (!video) return;

    let hls: Hls | null = null;
    if (Hls.isSupported()) {
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) setState('error');
      });
      hls.loadSource(src);
      hls.attachMedia(video);
    } else {
      video.src = src; // Safari/iOS memutar HLS secara native
    }
    void video.play().catch(() => {});
    const timer = setTimeout(() => setState('stopped'), MAX_WATCH_MS);

    return () => {
      clearTimeout(timer);
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
    };
  }, [state, src]);

  const label = state === 'idle' ? 'Putar live' : state === 'stopped' ? 'Lanjut menonton' : 'Coba lagi';

  return (
    <div className={className ?? 'relative h-full w-full bg-black'}>
      <video
        ref={videoRef}
        poster={poster ?? undefined}
        className="h-full w-full object-contain"
        muted
        playsInline
        controls={state === 'playing'}
        onError={() => {
          if (state === 'playing') setState('error');
        }}
      />
      {state !== 'playing' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 text-white">
          {state === 'error' && (
            <>
              <VideoOff className="h-10 w-10 opacity-60" />
              <p className="text-sm">Kamera offline</p>
            </>
          )}
          {state === 'stopped' && (
            <p className="px-4 text-center text-xs">Live dihentikan otomatis untuk menghemat kuota</p>
          )}
          <Button type="button" size="sm" onClick={() => setState('playing')} className="gap-1">
            <Play className="h-4 w-4" />
            {label}
          </Button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `rtk vitest run src/components/HlsPlayer.test.tsx`
Expected: PASS, 5 test.

- [ ] **Step 6: Pasang di CctvPanel & DeviceCard**

`src/components/CctvPanel.tsx`:
- Import: `import { HlsPlayer } from '@/components/HlsPlayer';`
- Setelah baris `const isIframe = ...`, tambahkan:
  ```tsx
  const isHls = hasStream && /\.m3u8/i.test(device.cctvUrl!);
  ```
- Di `renderLiveBody`, ganti `) : isIframe ? (` dengan:
  ```tsx
      ) : isHls ? (
        <HlsPlayer
          src={device.cctvUrl!}
          poster={imgSrc}
          className={forDialog ? 'absolute inset-0 bg-black' : 'relative h-full w-full bg-black'}
        />
      ) : isIframe ? (
  ```

`src/components/DeviceCard.tsx` — import `HlsPlayer` yang sama; di `CctvLiveStream`, tepat sebelum baris komentar `// Deteksi tipe URL: ...`, tambahkan:

```tsx
  if (/\.m3u8/i.test(url)) {
    return (
      <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-black">
        <HlsPlayer src={url} />
      </div>
    );
  }
```

- [ ] **Step 7: Tombol "Ambil snapshot" di DeviceSettings**

`src/pages/DeviceSettings.tsx`:
- Import ikon: tambahkan `Camera` ke import `lucide-react`.
- State (di bawah `const [cctvSaving, setCctvSaving] = useState(false);`):
  ```tsx
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  ```
- Handler (di bawah `handleCctvSubmit`):
  ```tsx
  const handleTakeSnapshot = async () => {
    setSnapshotLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/cctv/${encodeURIComponent(device.id)}/snapshot`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ deployment_slug: device.deploymentSlug }),
      });
      const body = (await res.json()) as { signedUrl?: string; error?: string };
      if (!res.ok || !body.signedUrl) throw new Error(body.error ?? 'Gagal mengambil snapshot');
      setSnapshotUrl(body.signedUrl);
      toast.success('Snapshot tersimpan');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSnapshotLoading(false);
    }
  };
  ```
- Di kartu CCTV, setelah `</form>` (sebelum `</Card>`), tambahkan:
  ```tsx
          <div className="mt-4 space-y-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={snapshotLoading || !cctvLocalIp.trim()}
              onClick={handleTakeSnapshot}
              className="gap-2"
            >
              <Camera className="h-4 w-4" />
              {snapshotLoading ? 'Mengambil...' : 'Ambil snapshot'}
            </Button>
            {snapshotUrl && (
              <img src={snapshotUrl} alt={`Snapshot ${device.name}`} className="w-full rounded-lg border border-border" />
            )}
          </div>
  ```

- [ ] **Step 7b: Foto terbaru dari `device_configs` (Task 11)**

Kolom baru (Task 11): `device_configs.snapshot_interval_min`, `last_snapshot_path`, `last_snapshot_at`; `device_configs` sudah di publication Realtime.

`src/lib/types.ts` — di interface `Device` (dekat `cctvCapturedAt`), tambahkan:

```ts
  /** Menit antar snapshot CCTV berkala; 0 = mati. */
  snapshotIntervalMin?: number;
```

`src/lib/sijagakali/fetchDashboard.ts`:
1. Tambahkan konstanta setelah `DEVICE_CONFIGS_SELECT_FULL`:
   ```ts
   const DEVICE_CONFIGS_SELECT_WITH_SNAPSHOT =
     `${DEVICE_CONFIGS_SELECT_FULL}, snapshot_interval_min, last_snapshot_path, last_snapshot_at`;
   ```
2. `DeviceConfigRow`: tambahkan `snapshot_interval_min?: number | null; last_snapshot_path?: string | null; last_snapshot_at?: string | null;`.
3. Di `fetchDashboardSnapshot`, query pertama pakai `DEVICE_CONFIGS_SELECT_WITH_SNAPSHOT`; tambahkan satu langkah fallback **sebelum** fallback `geoOnly` yang sudah ada:
   ```ts
   // Kompatibilitas: DB belum menjalankan migrasi snapshot (Task 11).
   if (isMissingColumnError(errConfigs)) {
     const full = await supabase
       .from('device_configs')
       .select(DEVICE_CONFIGS_SELECT_FULL)
       .eq('deployment_slug', deploymentSlug)
       .eq('is_active', true)
       .order('device_id');
     configs = full.data;
     errConfigs = full.error;
   }
   ```
4. Di pemetaan device, ganti:
   ```ts
    cctvImagePath: latest?.cctv_image_path ?? null,
    cctvCapturedAt: latest?.cctv_captured_at ?? null,
   ```
   dengan:
   ```ts
    // Foto terbaru per device (kejadian/berkala/manual); fallback ke reading lama.
    cctvImagePath: c.last_snapshot_path ?? latest?.cctv_image_path ?? null,
    cctvCapturedAt: c.last_snapshot_at ?? latest?.cctv_captured_at ?? null,
    snapshotIntervalMin: c.snapshot_interval_min ?? 15,
   ```

`src/lib/liveDataContext.tsx`:
1. Di handler INSERT `sensor_readings`, **kedua** tempat yang menulis `cctvImagePath,` / `cctvCapturedAt,` ke objek device diganti menjadi:
   ```ts
                  cctvImagePath: cctvImagePath ?? d.cctvImagePath,
                  cctvCapturedAt: cctvCapturedAt ?? d.cctvCapturedAt,
   ```
   dan `cctvSignedUrl: null` di kedua tempat itu diganti `cctvSignedUrl: cctvImagePath ? null : d.cctvSignedUrl` (reading tanpa foto tidak boleh mengosongkan foto terakhir).
2. Pada channel yang sama (`supabase.channel('sensor_readings_inserts')`), rangkaikan `.on(...)` kedua tepat setelah `.on(...)` INSERT dan sebelum `.subscribe(...)`:
   ```ts
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'sijagakali',
          table: 'device_configs',
          filter: `deployment_slug=eq.${deploymentSlug}`,
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          const path = (row.last_snapshot_path as string | null) ?? null;
          if (!path) return;
          const deviceId = String(row.device_id ?? '');
          setDevices((prev) =>
            prev.map((d) =>
              d.id === deviceId && d.cctvImagePath !== path
                ? {
                    ...d,
                    cctvImagePath: path,
                    cctvCapturedAt: (row.last_snapshot_at as string | null) ?? d.cctvCapturedAt,
                    cctvSignedUrl: null,
                  }
                : d
            )
          );
        }
      )
   ```

`src/pages/DeviceSettings.tsx` — interval snapshot berkala di kartu CCTV:
1. State (di bawah state snapshot dari Step 7):
   ```tsx
   const [snapshotInterval, setSnapshotInterval] = useState('15');
   const [snapshotIntervalSaving, setSnapshotIntervalSaving] = useState(false);
   ```
2. Di `useEffect` yang mengisi form dari `device` (yang berisi `setBmkgAdm4(...)`), tambahkan:
   `setSnapshotInterval(String(device.snapshotIntervalMin ?? 15));`
3. Handler:
   ```tsx
   const handleSnapshotIntervalSave = async () => {
     const n = Number(snapshotInterval);
     if (!Number.isInteger(n) || n < 0 || n > 1440) {
       toast.error('Interval snapshot harus bilangan bulat 0–1440 menit (0 = mati)');
       return;
     }
     setSnapshotIntervalSaving(true);
     try {
       const res = await fetch(`${API_BASE}/api/device/${device.id}/settings`, {
         method: 'POST',
         headers: authHeaders(),
         body: JSON.stringify({ deployment_slug: device.deploymentSlug, snapshot_interval_min: n }),
       });
       if (!res.ok) {
         const body = (await res.json()) as { error?: string };
         throw new Error(body.error ?? 'Gagal menyimpan interval snapshot');
       }
       await refreshDashboard();
       toast.success(n === 0 ? 'Snapshot berkala dimatikan' : `Snapshot berkala tiap ${n} menit`);
     } catch (err) {
       toast.error(err instanceof Error ? err.message : String(err));
     } finally {
       setSnapshotIntervalSaving(false);
     }
   };
   ```
4. Di blok `<div className="mt-4 space-y-2 border-t border-border pt-4">` dari Step 7, sebelum tombol "Ambil snapshot", tambahkan:
   ```tsx
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Snapshot berkala (menit, 0 = mati)
            </label>
            <div className="flex gap-2">
              <Input
                type="number"
                min={0}
                max={1440}
                value={snapshotInterval}
                onChange={(e) => setSnapshotInterval(e.target.value)}
                className="w-28"
              />
              <Button type="button" variant="outline" disabled={snapshotIntervalSaving} onClick={handleSnapshotIntervalSave}>
                {snapshotIntervalSaving ? 'Menyimpan...' : 'Simpan interval'}
              </Button>
            </div>
   ```

- [ ] **Step 8: Test & build seluruh app**

Run: `rtk vitest run && rtk tsc --noEmit -p tsconfig.app.json && rtk npm run build`
Expected: semua PASS, build sukses. (Bila `tsconfig.app.json` tidak ada, pakai `rtk tsc --noEmit`.)

- [ ] **Step 9: Commit**

```bash
rtk git add package.json package-lock.json src/components/HlsPlayer.tsx src/components/HlsPlayer.test.tsx src/components/CctvPanel.tsx src/components/DeviceCard.tsx src/pages/DeviceSettings.tsx
rtk git commit -m "feat: add quota-saving HLS live player (click-to-play, 5 min auto-stop) and admin snapshot button

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `sijagakali-ota` — kredensial MQTT + Docker

Kerjakan di `../sijagakali-ota`. Mulai dengan `rtk git checkout -b feat/docker-deploy`.

**Files:**
- Modify: `src/mqttClient.ts`, `.env.example`
- Create: `src/mqttClient.test.ts`, `Dockerfile`, `.dockerignore`, `docker-compose.yml`

**Interfaces:**
- Consumes: broker `mqtt://sijagakali-mosquitto:1883`, user `sijagakali-backend` (Task 5).
- Produces: `https://ota-sijagakali.inspiralabs.id` (frontend) + `/api/*` (backend). Dipakai Task 10.

- [ ] **Step 1: Tulis test yang gagal**

Create `src/mqttClient.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const connect = vi.fn(() => ({ on: vi.fn() }));
vi.mock('mqtt', () => ({ default: { connect } }));

describe('getMqttClient', () => {
  beforeEach(() => {
    vi.resetModules();
    connect.mockClear();
  });

  it('passes MQTT_USERNAME/MQTT_PASSWORD to the broker', async () => {
    process.env.MQTT_BROKER_URL = 'mqtt://sijagakali-mosquitto:1883';
    process.env.MQTT_USERNAME = 'sijagakali-backend';
    process.env.MQTT_PASSWORD = 'rahasia';
    const { getMqttClient } = await import('./mqttClient.js');
    getMqttClient();
    expect(connect).toHaveBeenCalledWith(
      'mqtt://sijagakali-mosquitto:1883',
      expect.objectContaining({ username: 'sijagakali-backend', password: 'rahasia' })
    );
  });

  it('connects anonymously when no username is set', async () => {
    delete process.env.MQTT_USERNAME;
    delete process.env.MQTT_PASSWORD;
    const { getMqttClient } = await import('./mqttClient.js');
    getMqttClient();
    expect(connect).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ username: undefined, password: undefined })
    );
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `rtk vitest run src/mqttClient.test.ts`
Expected: FAIL — `connect` dipanggil hanya dengan URL (tanpa objek opsi).

- [ ] **Step 3: Implementasi**

Ganti isi `src/mqttClient.ts`:

```ts
import mqtt, { MqttClient } from 'mqtt';

let client: MqttClient | undefined;

export function getMqttClient(): MqttClient {
  if (client) return client;

  const url = process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883';
  client = mqtt.connect(url, {
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    reconnectPeriod: 3000,
  });
  client.on('error', (err) => console.error('MQTT error:', err));
  return client;
}
```

`.env.example` — di bawah `MQTT_BROKER_URL=...` tambahkan:

```
MQTT_USERNAME=sijagakali-backend
MQTT_PASSWORD=
```

- [ ] **Step 4: Jalankan test, pastikan lulus**

Run: `rtk vitest run`
Expected: PASS (test baru + semua test lama).

- [ ] **Step 5: Docker**

Create `.dockerignore`:

```
node_modules
frontend/node_modules
dist
frontend/dist
.git
.env
*.log
```

(`frontend/.env` sengaja **tidak** di-ignore: isinya nilai publik `VITE_*` yang dibaca Vite saat build.)

Create `Dockerfile`:

```dockerfile
# sijagakali-ota: dua image — backend (Fastify) dan frontend (statis, nginx).
FROM node:22-bookworm-slim AS backend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS backend
ENV NODE_ENV=production
WORKDIR /app
COPY --from=backend-build --chown=node:node /app/package.json ./
COPY --from=backend-build --chown=node:node /app/node_modules ./node_modules
COPY --from=backend-build --chown=node:node /app/dist ./dist
USER node
CMD ["node", "dist/server.js"]

FROM node:22-bookworm-slim AS frontend-build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend ./
RUN npm run build

FROM nginxinc/nginx-unprivileged:1.27-alpine AS frontend
COPY --from=frontend-build /app/dist /usr/share/nginx/html
```

Create `docker-compose.yml`:

```yaml
# Deploy VPS — network `edge` + Traefik yang sama dengan sijagakali-api.
services:
  ota-api:
    build: { context: ., target: backend }
    image: sijagakali-ota:backend
    env_file: [.env]
    environment:
      PORT: "3787"
      MQTT_BROKER_URL: mqtt://sijagakali-mosquitto:1883
    restart: unless-stopped
    init: true
    networks: [edge]
    expose: ["3787"]
    labels:
      - traefik.enable=true
      - traefik.http.routers.sijagakali-ota-api.rule=Host(`ota-sijagakali.inspiralabs.id`) && PathPrefix(`/api`)
      - traefik.http.services.sijagakali-ota-api.loadbalancer.server.port=3787

  ota-web:
    build: { context: ., target: frontend }
    image: sijagakali-ota:frontend
    restart: unless-stopped
    networks: [edge]
    expose: ["8080"]
    labels:
      - traefik.enable=true
      - traefik.http.routers.sijagakali-ota-web.rule=Host(`ota-sijagakali.inspiralabs.id`)
      - traefik.http.services.sijagakali-ota-web.loadbalancer.server.port=8080

networks:
  edge:
    external: true
```

- [ ] **Step 6: Build image lokal**

Run: `docker compose build`
Expected: kedua image (`sijagakali-ota:backend`, `sijagakali-ota:frontend`) ter-build tanpa error.

Run: `docker run --rm --env-file .env -e MQTT_BROKER_URL=mqtt://127.0.0.1:1 -p 3787:3787 sijagakali-ota:backend` lalu di terminal lain `curl -s http://127.0.0.1:3787/health`
Expected: `{"ok":true}`. Hentikan container (Ctrl+C).

- [ ] **Step 7: Commit**

```bash
rtk git add src/mqttClient.ts src/mqttClient.test.ts .env.example Dockerfile .dockerignore docker-compose.yml
rtk git commit -m "feat: authenticate to MQTT broker and add Docker deployment for VPS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Firmware & dummy diarahkan ke broker VPS

**Files:**
- Modify: `../sijagakali-firmware/src/main.cpp:23` (branch `feat/vps-broker`)
- Modify: `../esp32-dummy/index.js` (`dummyWaterLevelCm`)

**Interfaces:**
- Consumes: `wss://mqtt-sijagakali.inspiralabs.id/mqtt`, user device `node-001` (Task 5).
- Produces: firmware `sijagakali-v1.0.0` yang terkoneksi ke broker VPS; dummy dengan `WATER_LEVEL_CM` untuk memicu notifikasi (Task 10).

- [ ] **Step 1: Firmware**

`cd ../sijagakali-firmware && rtk git checkout -b feat/vps-broker`. Di `src/main.cpp` ganti:

```cpp
#define MQTT_BROKER_URI "wss://YOUR_CLOUDFLARE_HOSTNAME/mqtt"
```

dengan:

```cpp
#define MQTT_BROKER_URI "wss://mqtt-sijagakali.inspiralabs.id/mqtt"
```

Ubah juga komentar di atasnya (baris "Cloudflare Tunnel serves this on the standard 443...") menjadi:

```cpp
// Broker mosquitto di VPS (docker compose sijagakali-api), WebSocket di belakang Traefik:
// TLS diterminasi Traefik di 443, diteruskan ke listener websockets 9001.
```

`MQTT_PASSWORD` **jangan** di-commit dengan nilai asli — biarkan placeholder `YOUR_DEVICE_MQTT_PASSWORD`; nilai asli diisi lokal saat flash (Task 10).

Run: `pio run`
Expected: `SUCCESS`.

```bash
rtk git add src/main.cpp
rtk git commit -m "feat: point firmware at VPS mosquitto over wss

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Dummy bisa paksa level air**

`../esp32-dummy/index.js` — di header komentar env vars tambahkan baris
`//   WATER_LEVEL_CM        paksa level tetap (mis. 150) untuk memicu notifikasi waspada/siaga`
dan ganti fungsi `dummyWaterLevelCm` dengan:

```js
function dummyWaterLevelCm() {
  if (process.env.WATER_LEVEL_CM) return Number(process.env.WATER_LEVEL_CM);
  const wave = 40 + 25 * Math.sin(Date.now() / 60000);
  const noise = (Math.random() - 0.5) * 2; // +-1cm
  return Math.max(0, Math.round((wave + noise) * 10) / 10);
}
```

Run: `node --check index.js`
Expected: tidak ada syntax error.

Commit di repo `esp32-dummy` (repo git sendiri):

```bash
rtk git add index.js
rtk git commit -m "feat: allow forcing water level via WATER_LEVEL_CM

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Deploy ke VPS + uji end-to-end

**Files:**
- Create: `deploy/e2e-checklist.md`

**Interfaces:**
- Consumes: semua task sebelumnya.
- Produces: bukti end-to-end (dicatat di checklist) — dasar laporan selesai.

- [ ] **Step 1: Tulis checklist**

Create `deploy/e2e-checklist.md`:

````markdown
# Checklist uji end-to-end SiJagaKali (VPS)

Isi kolom "Hasil" saat menjalankan. Semua harus ✅ sebelum dianggap selesai.

| # | Uji | Perintah / langkah | Lulus bila | Hasil |
|---|---|---|---|---|
| 1 | Dummy → broker → DB | Di `esp32-dummy`: `MQTT_URL=wss://mqtt-sijagakali.inspiralabs.id/mqtt MQTT_USERNAME=node-001 MQTT_PASSWORD=<pw> DEVICE_ID=node-001 READ_INTERVAL_SEC=30 npm start` | Log dummy `connected`; di Supabase: baris baru `mqtt_ingestion` (`dispatched_to_core`) dan `sensor_readings` node-001; `device_configs.last_seen_at` ter-update (≤2 menit) | |
| 2 | Notifikasi WA otomatis | Ulang #1 dengan `WATER_LEVEL_CM=<di atas threshold_waspada_cm node-001>` | `notification_logs` baris `status=sent`; pesan muncul di WA Channel | |
| 3 | Snapshot di notifikasi | `cctv_local_ip` node-001 terisi; reset cooldown (tunggu `notify_cooldown_waspada_sec` atau naikkan ke siaga); ulang #2 | WA berisi **gambar + teks**; objek ada di bucket `cctv-images/{slug}/node-001/{tanggal}/`; `sensor_readings.cctv_image_path` terisi | |
| 4 | ESP32-C5 asli | Isi `MQTT_PASSWORD` asli di `main.cpp` lokal (jangan commit), `pio run -t upload -t monitor` | Serial `MQTT: connected`; ulang cek #1 untuk data dari device asli | |
| 5 | ACL broker | `docker compose exec -e BACKEND_PASS=<pw> -e DEVICE_PASS=<pw> mosquitto sh /mosquitto/config/acl-check.sh` | `ACL OK` | |
| 6 | Live CCTV | Buka dashboard publik → tab Live → Putar live | Video main ≤10 s; setelah 5 menit muncul "Lanjut menonton"; tutup tab → `docker compose logs mediamtx` menunjukkan source ditutup ±70 s kemudian | |
| 7 | Snapshot manual | Admin → Pengaturan Perangkat node-001 → Ambil snapshot | Gambar tampil; toast "Snapshot tersimpan" | |
| 8 | OTA sukses | Naikkan `FIRMWARE_VERSION` ke `sijagakali-v1.0.1`, `pio run`, upload `.pio/build/esp32-c5-devkitc-1/firmware.bin` di `https://ota-sijagakali.inspiralabs.id`, deploy ke node-001 | `firmware_updates.status` sukses (ack `ok`), device reboot, `device_configs.firmware_version = sijagakali-v1.0.1` | |
| 9 | OTA gagal aman | Publish command dengan URL rusak: `docker compose exec mosquitto mosquitto_pub -u sijagakali-backend -P <pw> -t sijagakali/node-001/command -m '{"cmd":"ota_update","request_id":"bad-1","params":{"url":"https://ota-sijagakali.inspiralabs.id/tidak-ada.bin"}}'` | Ack `ok:false`; device tetap v1.0.1 dan tetap kirim data | |
````

Commit:

```bash
rtk git add deploy/e2e-checklist.md
rtk git commit -m "docs: add end-to-end test checklist for VPS deployment

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: [USER] DNS**

Di Cloudflare zona `inspiralabs.id`, buat record untuk `mqtt-sijagakali`, `cctv-sijagakali`, `ota-sijagakali` — **sama persis** (tipe, target, proxied) dengan record `api-sijagakali` yang sudah ada. Verifikasi: `nslookup mqtt-sijagakali.inspiralabs.id` mengembalikan IP Cloudflare seperti `api-sijagakali`.

- [ ] **Step 3: [USER] Broker di VPS**

Di VPS, folder `sijagakali-api` (pull branch `deploy/vps` lewat alur deploy yang sudah dipakai untuk commit `241a933`):

```bash
docker compose run --rm --entrypoint mosquitto_passwd mosquitto -c -b /mosquitto/data/pwfile sijagakali-backend '<PW_BACKEND>'
docker compose run --rm --entrypoint mosquitto_passwd mosquitto -b /mosquitto/data/pwfile node-001 '<PW_NODE_001>'
```

Edit `.env` VPS: `MQTT_USERNAME=sijagakali-backend`, `MQTT_PASSWORD=<PW_BACKEND>`, `CCTV_USERNAME`, `CCTV_PASSWORD`. Simpan semua password di password manager.

- [ ] **Step 4: [USER] Jaringan CCTV**

Ikuti `deploy/cctv-network.md` bagian 1–3 sampai **verifikasi wajib** menghasilkan `200 image/jpeg` dari container. Lalu `cp deploy/mediamtx.example.yml deploy/mediamtx.yml`, isi `hlsAllowOrigins`, `CCTV_USER:CCTV_PASS`, IP kamera.

- [ ] **Step 5: [USER] Deploy**

```bash
docker compose up -d --build
docker compose ps
bash deploy/smoke.sh && echo SMOKE OK
docker compose logs --tail=50 mqtt-collector data-processing notification-gateway mosquitto mediamtx
```

Expected: semua service `running`/`healthy`; `SMOKE OK`; collector log `Connected to mqtt://sijagakali-mosquitto:1883` dan `Subscribed to all topics`; mediamtx `[HLS] listener opened`.

Deploy app: merge `feat/cctv-hls-player` lewat alur deploy `sijagakali-app` (Vercel) yang biasa.

Deploy OTA (folder `sijagakali-ota` di VPS, branch `feat/docker-deploy`): isi `.env` (Supabase, R2, `MQTT_USERNAME=sijagakali-backend`, `MQTT_PASSWORD`), `frontend/.env` (`VITE_OTA_API_URL=https://ota-sijagakali.inspiralabs.id`, Supabase anon, Turnstile). Jalankan migrasi tabel OTA sekali dari laptop (idempotent, `if not exists`): `npm run migrate` dengan `DATABASE_URL` produksi. Lalu `docker compose up -d --build`.

Verifikasi: `curl -s https://ota-sijagakali.inspiralabs.id/api/firmware -o /dev/null -w "%{http_code}\n"` → `401` (butuh login = backend hidup); halaman `https://ota-sijagakali.inspiralabs.id` terbuka.

- [ ] **Step 6: Jalankan checklist #1–#9**

Kerjakan `deploy/e2e-checklist.md` berurutan, isi kolom Hasil. Bila #1 gagal konek dengan path `/mqtt`, coba `wss://mqtt-sijagakali.inspiralabs.id` (tanpa path) — bila itu yang jalan, ubah `MQTT_BROKER_URI` firmware & checklist ke URL tersebut dan commit.

- [ ] **Step 7: Commit hasil checklist**

```bash
rtk git add deploy/e2e-checklist.md
rtk git commit -m "docs: record end-to-end test results

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Snapshot berkala (interval diatur admin) + "foto terbaru" per device

> Ditambahkan 2026-10-01 atas keputusan user: snapshot berkala tiap 15 menit (interval bisa diatur admin per device), tetap snapshot di tiap kejadian, tombol manual tetap. **Dieksekusi setelah Task 6, sebelum Task 7** (Task 7 memakai kolom yang dibuat di sini).
>
> Sekaligus memperbaiki bug: dashboard mengambil foto dari *baris sensor terbaru*; dengan pembacaan tiap 1 menit, foto alarm hilang dari dashboard 1 menit kemudian. Sumber "foto terbaru" dipindah ke `device_configs.last_snapshot_path/at`, yang diisi oleh **setiap** snapshot (kejadian, berkala, manual) lewat `captureSnapshot`.

**Files:**
- Create: `supabase/migrations/20261001120000_device_configs_snapshot.sql`
- Create: `shared/src/snapshotSchedule.ts`, `shared/src/snapshotSchedule.test.ts`
- Modify: `shared/src/cctvSnapshot.ts` (update `device_configs` setelah upload), `shared/src/index.ts`, `supabase/README.md`
- Modify: `data-processing/src/index.ts` (loop snapshot berkala)
- Modify: `api/src/routes/device.ts` (`POST /api/device/:deviceId/settings` menerima `snapshot_interval_min`)

**Interfaces:**
- Consumes: `captureSnapshot` (Task 3), `getSupabase()`.
- Produces:
  - Kolom `device_configs.snapshot_interval_min integer NOT NULL DEFAULT 15` (0 = mati, maks 1440), `last_snapshot_path text`, `last_snapshot_at timestamptz`; `device_configs` masuk publication `supabase_realtime`.
  - `isSnapshotDue(lastAt: string | number | null | undefined, intervalMin: number, now?: number): boolean`
  - `captureSnapshot` kini juga meng-update `device_configs.last_snapshot_path/at` (signature tetap).
  - Settings endpoint menerima `snapshot_interval_min` (int 0–1440). Dipakai Task 7.

- [ ] **Step 1: Migrasi**

Create `supabase/migrations/20261001120000_device_configs_snapshot.sql`:

```sql
-- Snapshot CCTV: interval berkala per device (diatur admin) + foto terbaru untuk dashboard.
ALTER TABLE sijagakali.device_configs
  ADD COLUMN IF NOT EXISTS snapshot_interval_min integer NOT NULL DEFAULT 15
    CHECK (snapshot_interval_min >= 0 AND snapshot_interval_min <= 1440),
  ADD COLUMN IF NOT EXISTS last_snapshot_path text,
  ADD COLUMN IF NOT EXISTS last_snapshot_at timestamptz;

COMMENT ON COLUMN sijagakali.device_configs.snapshot_interval_min IS
  'Menit antar snapshot berkala CCTV; 0 = mati. Snapshot kejadian & manual tetap jalan.';

-- Dashboard menerima foto terbaru secara realtime (UPDATE device_configs).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sijagakali.device_configs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
```

Tambahkan baris di tabel `supabase/README.md` bagian "Isi folder":

```
| `migrations/20261001120000_device_configs_snapshot.sql` | Kolom `snapshot_interval_min`, `last_snapshot_path`, `last_snapshot_at` + `device_configs` ke Realtime (snapshot CCTV berkala) |
```

- [ ] **Step 2: Tulis test yang gagal**

Create `shared/src/snapshotSchedule.test.ts`:

```ts
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
```

- [ ] **Step 3: Jalankan, pastikan gagal**

Run: `npm test`
Expected: FAIL — `Cannot find module '.../snapshotSchedule.js'`.

- [ ] **Step 4: Implementasi**

Create `shared/src/snapshotSchedule.ts`:

```ts
/**
 * Apakah snapshot berkala sudah jatuh tempo?
 * `lastAt` = ISO string (kolom DB) atau epoch ms; null/tidak valid → langsung tempo.
 * `intervalMin` ≤ 0 → snapshot berkala mati.
 */
export function isSnapshotDue(
  lastAt: string | number | null | undefined,
  intervalMin: number,
  now = Date.now()
): boolean {
  if (!(intervalMin > 0)) return false;
  if (lastAt == null) return true;
  const last = typeof lastAt === 'number' ? lastAt : Date.parse(lastAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= intervalMin * 60_000;
}
```

`shared/src/index.ts` — tambahkan `export * from './snapshotSchedule.js';`.

`shared/src/cctvSnapshot.ts` — tambahkan `getSupabase` ke import dari `./supabaseClient.js`, lalu tepat sebelum `return path;` tambahkan:

```ts
    // Satu sumber "foto terbaru" untuk dashboard + jam terakhir snapshot (dasar jadwal berkala).
    const { error: cfgErr } = await getSupabase()
      .from('device_configs')
      .update({ last_snapshot_path: path, last_snapshot_at: new Date().toISOString() })
      .eq('deployment_slug', opts.deploymentSlug)
      .eq('device_id', opts.deviceId);
    if (cfgErr) console.error('[cctv_snapshot] UPDATE device_configs.last_snapshot gagal:', cfgErr.message);
```

(Gagal update tidak membatalkan path — foto sudah di Storage dan tetap dipakai notifikasi.)

- [ ] **Step 5: Jalankan test, pastikan lulus**

Run: `npm test`
Expected: PASS (semua test lama + 5 test baru).

- [ ] **Step 6: Loop snapshot berkala di data-processing**

`data-processing/src/index.ts` — tambahkan `isSnapshotDue,` ke import `@sijagakali/shared` (`captureSnapshot` sudah diimport di Task 4). Tambahkan sebelum blok `setInterval(() => { console.log('[processing] metrics' ...`:

```ts
/** Cek jadwal snapshot berkala tiap menit; interval per device diatur admin (snapshot_interval_min). */
const SNAPSHOT_TICK_MS = 60_000;
/** Percobaan terakhir per device (termasuk yang gagal) — kamera mati tidak dicoba ulang tiap menit. */
const lastSnapshotAttempt = new Map<string, number>();
let snapshotTickRunning = false;

async function runPeriodicSnapshots() {
  if (snapshotTickRunning) return;
  snapshotTickRunning = true;
  try {
    const { data, error } = await supabase
      .from('device_configs')
      .select('deployment_slug,device_id,cctv_local_ip,snapshot_interval_min,last_snapshot_at')
      .eq('is_active', true)
      .not('cctv_local_ip', 'is', null)
      .gt('snapshot_interval_min', 0);
    if (error) {
      console.error('[processing] query snapshot berkala gagal:', error.message);
      return;
    }
    const now = Date.now();
    for (const row of data ?? []) {
      const host = String(row.cctv_local_ip ?? '').trim();
      const interval = Number(row.snapshot_interval_min);
      const key = `${row.deployment_slug}:${row.device_id}`;
      if (!host) continue;
      if (!isSnapshotDue(row.last_snapshot_at as string | null, interval, now)) continue;
      if (!isSnapshotDue(lastSnapshotAttempt.get(key), interval, now)) continue;
      lastSnapshotAttempt.set(key, now);
      const path = await captureSnapshot({
        host,
        deploymentSlug: row.deployment_slug as string,
        deviceId: row.device_id as string,
      });
      if (path) console.log(`[processing] snapshot berkala OK — device=${row.device_id}`);
    }
  } finally {
    snapshotTickRunning = false;
  }
}

setInterval(() => {
  void runPeriodicSnapshots();
}, SNAPSHOT_TICK_MS);
```

Karena `last_snapshot_at` juga diisi snapshot kejadian & manual, foto berkala berikutnya otomatis mundur — tidak ada dua foto beruntun saat alarm.

- [ ] **Step 7: Settings endpoint menerima `snapshot_interval_min`**

`api/src/routes/device.ts`, route `POST /api/device/:deviceId/settings`:
1. Body type: tambahkan `snapshot_interval_min?: number;`.
2. Destrukturisasi `req.body`: tambahkan `snapshot_interval_min,`.
3. Setelah validasi cooldown yang ada (`const cw = optionalNonnegInt(...)` dst.), tambahkan:
   ```ts
   const si = optionalNonnegInt(snapshot_interval_min, 'snapshot_interval_min', 1440);
   if (!si.ok) return reply.code(400).send({ error: si.error });
   ```
4. Di blok pengisian `updates` (dekat `if (cw.value !== undefined) ...`), tambahkan:
   ```ts
   if (si.value !== undefined) updates.snapshot_interval_min = si.value;
   ```

- [ ] **Step 8: Build + test**

Run: `npm run build && npm test`
Expected: sukses, semua PASS.

Verifikasi route terlindungi (API dev server, tanpa token): `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://127.0.0.1:3100/api/device/node-001/settings -H "Content-Type: application/json" -d "{\"snapshot_interval_min\":-1}"` → `401`. Validasi 400 dan nilai tersimpan diuji di Task 10 dengan token admin.

- [ ] **Step 9: Commit**

```bash
rtk git add supabase/migrations/20261001120000_device_configs_snapshot.sql supabase/README.md shared data-processing/src/index.ts api/src/routes/device.ts
rtk git commit -m "feat: periodic CCTV snapshots with admin-configurable interval and per-device latest snapshot

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
