# Suhu Raspberry Pi di kartu perangkat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kartu perangkat menampilkan suhu CPU Raspberry Pi lokasi (atau `—` bila basi/tidak ada) dan baterai selalu `—`.

**Architecture:** Pi mengirim `{"pi_temp_c":N}` tiap 2 menit lewat MQTT (`sijagakali/<device_id>/cctv/pi-status`, akun device) → `mqtt-collector` memvalidasi dan menyimpan ke `device_configs.pi_temp_c/pi_temp_at` → dashboard membaca kolom itu dan menampilkan suhu bila ≤ 10 menit.

**Tech Stack:** bash + systemd + mosquitto-clients (Pi); TypeScript, node:test, Supabase/Postgres (sijagakali-api); React + Vite + vitest (sijagakali-app).

**Spec:** `docs/superpowers/specs/2026-10-04-pi-temperature-design.md`

## Global Constraints

- Topik: `sijagakali/<device_id>/cctv/pi-status`; payload `{"pi_temp_c": <number>}`; QoS 1.
- Broker: `mqtt.inspiralabs.id:8883` (TLS, CA sistem `/etc/ssl/certs`); akun MQTT = akun device (`node-001`).
- Kredensial Pi hanya di `/etc/sijagakali/mqtt.conf` (mode `600`, root): `MQTT_DEVICE_ID`, `MQTT_PASSWORD`. Tidak di repo, tidak di `site.conf`.
- Interval kirim: 2 menit (`OnBootSec=1min`, `OnUnitActiveSec=2min`).
- Rentang suhu valid: −20…120 °C, dibulatkan 1 desimal; di luar itu ditolak.
- Kolom: `device_configs.pi_temp_c numeric(5,1)`, `device_configs.pi_temp_at timestamptz`, keduanya nullable; `pi_temp_at` = jam server.
- Dashboard: suhu ditampilkan bila `pi_temp_at` ≤ 10 menit yang lalu, selain itu `—`. Baterai selalu `—`.
- Repo & branch: `sijagakali-api` di worktree `../sijagakali-api-pi-temp` branch `feat/pi-temperature` (dari `origin/master`); `sijagakali-app` branch baru `feat/pi-temperature` dari `origin/main`.

## Review Focus

1. **Pi tanpa internet / broker tidak terjangkau** → `sjk-report` tidak boleh menggantung selamanya (dibungkus `timeout 20`), tercatat "gagal" di `/run/sijagakali/last-report`, timer tetap jalan berikutnya. (Task 4, langkah uji manual dengan host salah.)
2. **`mqtt.conf` belum dibuat** (Pi lama / baru di-setup) → `sjk-report` keluar 0 tanpa error, `sjk-health` menulis "belum dikonfigurasi". (Task 4.)
3. **Payload aneh** (`"52.1"` string, `null`, `{}`, `NaN`, `999`, JSON rusak) → collector tidak menulis kolom, hanya `warn`. (Task 1 tests + Task 2 try/catch.)
4. **Migrasi belum dijalankan di Supabase** → dashboard tetap jalan (fallback ke select lama, snapshot tidak hilang), suhu `—`. (Task 3, test fallback select.)
5. **Halaman dashboard dibuka lama** → kesegaran dihitung saat data dimuat; suhu tidak berubah sampai reload. Dicatat sebagai batasan yang diterima, bukan bug. (Task 3, komentar di kode.)

---

### Task 1: Validator suhu Pi + tipe/topik bersama (sijagakali-api/shared)

**Files:**
- Create: `shared/src/piStatus.ts`
- Create: `shared/src/piStatus.test.ts`
- Modify: `shared/src/types.ts` (objek `TOPICS`, baris ±34–41)
- Modify: `shared/src/index.ts` (tambah export)

**Interfaces:**
- Produces: `parsePiTemp(payload: unknown): number | null`; `TOPICS.PI_STATUS: 'sijagakali/+/cctv/pi-status'`; `interface PiStatusPayload { pi_temp_c: number }`.

- [ ] **Step 1: Tulis test yang gagal** — `shared/src/piStatus.test.ts`

```ts
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
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run (di root worktree): `node --import tsx --test shared/src/piStatus.test.ts`
Expected: FAIL — `Cannot find module './piStatus.js'`.

- [ ] **Step 3: Implementasi minimal** — `shared/src/piStatus.ts`

```ts
/** Suhu CPU Raspberry Pi dari payload `cctv/pi-status`; null bila bukan angka −20…120 °C. */
export function parsePiTemp(payload: unknown): number | null {
  const t = (payload as { pi_temp_c?: unknown } | null)?.pi_temp_c;
  if (typeof t !== 'number' || !Number.isFinite(t) || t < -20 || t > 120) return null;
  return Math.round(t * 10) / 10;
}
```

Di `shared/src/types.ts`, tambahkan setelah `SensorStatusPayload`:

```ts
/** Payload MQTT topik `sijagakali/{device_id}/cctv/pi-status` (Raspberry Pi lokasi) */
export interface PiStatusPayload {
  pi_temp_c: number;
}
```

dan di objek `TOPICS` setelah `CCTV_META`:

```ts
  PI_STATUS: 'sijagakali/+/cctv/pi-status',
```

Di `shared/src/index.ts` tambahkan: `export * from './piStatus.js';`

- [ ] **Step 4: Jalankan test, pastikan lolos**

Run: `node --import tsx --test shared/src/piStatus.test.ts` → PASS. Lalu `npm test` → semua PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/src/piStatus.ts shared/src/piStatus.test.ts shared/src/types.ts shared/src/index.ts
git commit -m "feat(shared): validate Raspberry Pi temperature payload"
```

### Task 2: Migrasi kolom + collector menyimpan suhu Pi (sijagakali-api)

**Files:**
- Create: `supabase/migrations/20261004090000_device_configs_pi_temp.sql`
- Modify: `mqtt-collector/src/index.ts` (import, `subscribe`, router `message`, handler baru)

**Interfaces:**
- Consumes: `parsePiTemp`, `TOPICS.PI_STATUS` (Task 1).
- Produces: kolom `sijagakali.device_configs.pi_temp_c numeric(5,1)`, `pi_temp_at timestamptz` (dibaca Task 3).

- [ ] **Step 1: Migrasi** — `supabase/migrations/20261004090000_device_configs_pi_temp.sql`

```sql
-- Suhu CPU Raspberry Pi lokasi (topik MQTT cctv/pi-status), ditulis mqtt-collector.
-- pi_temp_at = jam server saat diterima; dashboard menampilkan suhu bila <= 10 menit.
ALTER TABLE sijagakali.device_configs
  ADD COLUMN IF NOT EXISTS pi_temp_c numeric(5,1),
  ADD COLUMN IF NOT EXISTS pi_temp_at timestamptz;
```

- [ ] **Step 2: Collector** — di `mqtt-collector/src/index.ts`:

Import: tambahkan `parsePiTemp` ke import dari `'@sijagakali/shared'` yang berisi `TOPICS`.

Subscribe: ubah array menjadi
`[TOPICS.SENSOR_DATA, TOPICS.CCTV_IMAGE, TOPICS.CCTV_META, TOPICS.SENSOR_STATUS, TOPICS.PI_STATUS]`.

Router `client.on('message')`: tambahkan cabang sebelum `sensor/status`:

```ts
    } else if (topic.endsWith('/cctv/pi-status')) {
      await handlePiStatus(topic, payload);
```

Handler baru (letakkan setelah `handleSensorStatus`):

```ts
async function handlePiStatus(topic: string, payload: Buffer) {
  const deviceId = extractDeviceId(topic);
  if (!deviceId) return;

  let temp: number | null = null;
  try {
    temp = parsePiTemp(JSON.parse(payload.toString('utf8')));
  } catch {
    // JSON rusak → temp tetap null
  }
  if (temp === null) {
    console.warn('[collector] cctv/pi-status payload tidak valid untuk device', deviceId);
    return;
  }

  const { error } = await supabase
    .from('device_configs')
    .update({ pi_temp_c: temp, pi_temp_at: new Date().toISOString() })
    .eq('deployment_slug', defaultDeployment)
    .eq('device_id', deviceId);

  if (error) console.error('[collector] UPDATE pi_temp failed:', error.message);
}
```

- [ ] **Step 3: Verifikasi build**

Run: `npm run build` (root worktree) → sukses tanpa error TypeScript. `npm test` → semua PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20261004090000_device_configs_pi_temp.sql mqtt-collector/src/index.ts
git commit -m "feat(collector): store Raspberry Pi temperature from cctv/pi-status"
```

### Task 3: Dashboard — suhu Pi dan baterai "—" (sijagakali-app)

Kerjakan di `sijagakali-app` branch `feat/pi-temperature` dari `origin/main` (`git checkout -b feat/pi-temperature origin/main`).

**Files:**
- Create: `src/lib/sijagakali/piTemp.ts`
- Create: `src/lib/sijagakali/piTemp.test.ts`
- Modify: `src/lib/sijagakali/fetchDashboard.ts` (konstanta select ±baris 6–13, tipe config row, query ±145–150, mapping ±118–120)
- Modify: `src/lib/types.ts:30` (`boxTemp`)
- Modify: `src/components/DeviceCard.tsx:257-268`
- Modify: `src/components/DeviceHealth.tsx:24-38`

**Interfaces:**
- Consumes: kolom `pi_temp_c`, `pi_temp_at` (Task 2). PostgREST mengembalikan `numeric` sebagai **number atau string** tergantung konfigurasi — tangani keduanya.
- Produces: `freshPiTemp(temp: number | string | null | undefined, at: string | null | undefined, now?: number): number | null`; `Device.boxTemp: number | null`.

- [ ] **Step 1: Tulis test yang gagal** — `src/lib/sijagakali/piTemp.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { freshPiTemp } from './piTemp';

const NOW = Date.parse('2026-10-04T10:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe('freshPiTemp', () => {
  it('returns the temperature when reported within 10 minutes', () => {
    expect(freshPiTemp(52.1, ago(3), NOW)).toBe(52.1);
    expect(freshPiTemp(52.1, ago(10), NOW)).toBe(52.1);
  });
  it('accepts numeric strings from PostgREST numeric columns', () => {
    expect(freshPiTemp('48.5', ago(1), NOW)).toBe(48.5);
  });
  it('returns null when stale, missing, or not a number', () => {
    expect(freshPiTemp(52.1, ago(11), NOW)).toBeNull();
    expect(freshPiTemp(null, ago(1), NOW)).toBeNull();
    expect(freshPiTemp(52.1, null, NOW)).toBeNull();
    expect(freshPiTemp('abc', ago(1), NOW)).toBeNull();
    expect(freshPiTemp(52.1, 'not-a-date', NOW)).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run src/lib/sijagakali/piTemp.test.ts` → FAIL (modul tidak ada).

- [ ] **Step 3: Implementasi** — `src/lib/sijagakali/piTemp.ts`

```ts
const MAX_AGE_MS = 10 * 60_000;

/**
 * Suhu CPU Raspberry Pi lokasi bila laporan terakhirnya <= 10 menit, selain itu null (tampil "—").
 * Kesegaran dihitung saat data dimuat; halaman yang dibiarkan terbuka tidak memperbaruinya sampai reload.
 */
export function freshPiTemp(
  temp: number | string | null | undefined,
  at: string | null | undefined,
  now: number = Date.now(),
): number | null {
  const t = typeof temp === 'string' ? Number(temp) : temp;
  const atMs = at ? Date.parse(at) : NaN;
  if (typeof t !== 'number' || !Number.isFinite(t) || !Number.isFinite(atMs)) return null;
  return now - atMs <= MAX_AGE_MS ? t : null;
}
```

- [ ] **Step 4: Jalankan test, pastikan lolos**

Run: `npx vitest run src/lib/sijagakali/piTemp.test.ts` → PASS.

- [ ] **Step 5: Sambungkan ke `fetchDashboard.ts`**

Konstanta baru setelah `DEVICE_CONFIGS_SELECT_WITH_SNAPSHOT`:

```ts
const DEVICE_CONFIGS_SELECT_WITH_PI = `${DEVICE_CONFIGS_SELECT_WITH_SNAPSHOT}, pi_temp_c, pi_temp_at`;
```

Tipe baris config (yang berisi `display_name?`, `bmkg_adm4?`): tambahkan

```ts
  pi_temp_c?: number | string | null;
  pi_temp_at?: string | null;
```

Query pertama: ganti blok `let { data: configs, error: errConfigs } = await supabase ... .select(DEVICE_CONFIGS_SELECT_WITH_SNAPSHOT) ...` menjadi select `WITH_PI` yang jatuh ke `WITH_SNAPSHOT` (rantai fallback lama tetap di bawahnya, tidak diubah):

```ts
  let { data: configs, error: errConfigs } = await supabase
    .from('device_configs')
    .select(DEVICE_CONFIGS_SELECT_WITH_PI)
    .eq('deployment_slug', deploymentSlug)
    .eq('is_active', true)
    .order('device_id');

  // Kompatibilitas: DB belum menjalankan migrasi suhu Pi (20261004090000).
  if (isMissingColumnError(errConfigs)) {
    const snap = await supabase
      .from('device_configs')
      .select(DEVICE_CONFIGS_SELECT_WITH_SNAPSHOT)
      .eq('deployment_slug', deploymentSlug)
      .eq('is_active', true)
      .order('device_id');
    configs = snap.data as typeof configs;
    errConfigs = snap.error;
  }
```

Mapping (±baris 118–120): `boxTemp: 0,` → `boxTemp: freshPiTemp(c.pi_temp_c, c.pi_temp_at),` dan tambahkan `import { freshPiTemp } from './piTemp';` di atas file. Biarkan `battery: latest?.battery_pct ?? 0` (tidak ditampilkan lagi).

Di `src/lib/types.ts`: `boxTemp: number;` → `boxTemp: number | null;`

- [ ] **Step 6: Tampilan** — `src/components/DeviceCard.tsx`, ganti isi dua span baterai & suhu:

```tsx
        <span className="flex items-center gap-1" title="Belum ada sensor baterai">
          <Battery className="h-3.5 w-3.5" />
          —
        </span>
```
```tsx
        <span className="flex items-center gap-1" title="Suhu CPU Raspberry Pi lokasi">
          <Thermometer className="h-3.5 w-3.5" />
          {device.boxTemp === null ? '—' : `${device.boxTemp}°C`}
        </span>
```

`src/components/DeviceHealth.tsx`: baris baterai (ikon + `Progress` + `%`) diganti

```tsx
                <div className="flex items-center gap-2" title="Belum ada sensor baterai">
                  <Battery className="h-3.5 w-3.5" />
                  <span>—</span>
                </div>
```

dan suhu `<span>{d.boxTemp}°C</span>` → `<span>{d.boxTemp === null ? '—' : `${d.boxTemp}°C`}</span>`. Hapus import `Progress` bila tidak dipakai lagi.

- [ ] **Step 7: Verifikasi**

Run: `npm test` → semua PASS; `npx tsc --noEmit -p tsconfig.app.json` (atau `npx tsc --noEmit` bila file itu tidak ada) → tanpa error; `npm run build` → sukses; `npm run lint` → tidak ada error baru di file yang diubah.

- [ ] **Step 8: Commit**

```bash
git add src/lib/sijagakali/piTemp.ts src/lib/sijagakali/piTemp.test.ts src/lib/sijagakali/fetchDashboard.ts src/lib/types.ts src/components/DeviceCard.tsx src/components/DeviceHealth.tsx
git commit -m "feat: show Raspberry Pi temperature on device cards; battery shows — until a sensor exists"
```

### Task 4: Raspberry Pi mengirim suhu (sijagakali-api/deploy/raspberry-pi)

**Files:**
- Create: `deploy/raspberry-pi/sjk-report`
- Modify: `deploy/raspberry-pi/setup.sh` (langkah baru setelah langkah 7 Tailscale; `install` baris di langkah 1; motd langkah 9)
- Modify: `deploy/raspberry-pi/sjk-health` (baris baru setelah `Suhu`)
- Modify: `docs/panduan/02-raspberry-pi.md` (bagian baru setelah "### 11. Pemeriksaan kesehatan")

**Interfaces:**
- Consumes: topik & payload dari Global Constraints; collector Task 2.
- Produces: `/run/sijagakali/last-report` berisi satu baris `<ISO waktu> OK <suhu>` atau `<ISO waktu> GAGAL <alasan>`.

- [ ] **Step 1: Skrip** — `deploy/raspberry-pi/sjk-report`

```bash
#!/bin/bash
# Kirim suhu CPU Pi ke server lewat MQTT (dipanggil sjk-report.timer tiap 2 menit).
# Kredensial: /etc/sijagakali/mqtt.conf (MQTT_DEVICE_ID, MQTT_PASSWORD), mode 600.
set -uo pipefail
CONF=/etc/sijagakali/mqtt.conf
OUT=/run/sijagakali/last-report
[ -r "$CONF" ] || exit 0   # belum dikonfigurasi: Pi tetap jalan sebagai jembatan kamera
. "$CONF"
mkdir -p /run/sijagakali
temp=$(vcgencmd measure_temp | grep -oE '[0-9]+(\.[0-9]+)?')
if [ -z "$temp" ]; then echo "$(date -Iseconds) GAGAL baca suhu" > "$OUT"; exit 1; fi
if err=$(timeout 20 mosquitto_pub -h mqtt.inspiralabs.id -p 8883 --capath /etc/ssl/certs \
      -u "$MQTT_DEVICE_ID" -P "$MQTT_PASSWORD" -i "sjk-pi-$MQTT_DEVICE_ID" -q 1 \
      -t "sijagakali/$MQTT_DEVICE_ID/cctv/pi-status" -m "{\"pi_temp_c\":$temp}" 2>&1); then
  echo "$(date -Iseconds) OK ${temp}C" > "$OUT"
else
  echo "$(date -Iseconds) GAGAL ${err:-timeout}" > "$OUT"; exit 1
fi
```

- [ ] **Step 2: `setup.sh`**

Langkah 1, baris `install -m 755 "$HERE/sjk-apply" "$HERE/sjk-health" /usr/local/bin/` → tambahkan `"$HERE/sjk-report"`.

Langkah baru setelah blok `log "7. tailscale + ip forwarding"` (sebelum `log "8. SSH hanya dengan key"`):

```bash
log "7b. laporan suhu ke server (MQTT, tiap 2 menit)"
apt-get -y -qq install mosquitto-clients
cat > /etc/systemd/system/sjk-report.service <<'UNIT'
[Unit]
Description=SiJagaKali: kirim suhu Pi ke MQTT
After=network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/sjk-report
UNIT
cat > /etc/systemd/system/sjk-report.timer <<'UNIT'
[Unit]
Description=SiJagaKali: kirim suhu Pi tiap 2 menit
[Timer]
OnBootSec=1min
OnUnitActiveSec=2min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now sjk-report.timer
[ -f /etc/sijagakali/mqtt.conf ] || echo "   Catatan: buat /etc/sijagakali/mqtt.conf (lihat docs/panduan/02-raspberry-pi.md) agar suhu terkirim."
```

Langkah 9 motd: tambahkan baris `    sudo sjk-report                     kirim suhu ke server sekarang (uji)`.

- [ ] **Step 3: `sjk-health`** — setelah baris `row Suhu ...`:

```bash
if [ -e /etc/sijagakali/mqtt.conf ]; then   # -e, bukan -r: sjk-health jalan tanpa sudo, file mode 600
  row "Lapor MQTT" "$(cat /run/sijagakali/last-report 2>/dev/null || echo 'belum ada kiriman')"
else
  row "Lapor MQTT" "belum dikonfigurasi (/etc/sijagakali/mqtt.conf)"
fi
```

- [ ] **Step 4: Panduan** — `docs/panduan/02-raspberry-pi.md`, tambahkan setelah bagian "### 11. Pemeriksaan kesehatan":

````markdown
### 11b. Kirim suhu Pi ke dashboard
Suhu CPU Pi dikirim tiap 2 menit lewat MQTT dan tampil di kartu perangkat (memakai akun MQTT device yang sama dengan ESP32 lokasi ini).
```bash
sudo install -m 600 /dev/null /etc/sijagakali/mqtt.conf
sudo nano /etc/sijagakali/mqtt.conf
#   MQTT_DEVICE_ID=node-001
#   MQTT_PASSWORD=<password akun MQTT node-001>
sudo sjk-report && sjk-health      # baris "Lapor MQTT" harus OK
```
````

- [ ] **Step 5: Cek sintaks lokal**

Run: `bash -n deploy/raspberry-pi/sjk-report deploy/raspberry-pi/setup.sh deploy/raspberry-pi/sjk-health` → tanpa output. Pastikan file `sjk-report` ber-LF (bukan CRLF): `git ls-files --eol deploy/raspberry-pi/sjk-report` menunjukkan `w/lf` setelah commit; bila `crlf`, ubah dengan `sed -i 's/\r$//'`.

- [ ] **Step 6: Commit**

```bash
git add deploy/raspberry-pi/sjk-report deploy/raspberry-pi/setup.sh deploy/raspberry-pi/sjk-health docs/panduan/02-raspberry-pi.md
git commit -m "feat(pi): report CPU temperature to MQTT every 2 minutes"
```

- [ ] **Step 7: Uji manual di Pi (oleh pemilik, setelah PR api di-merge & migrasi dijalankan)**

1. `scp -r deploy/raspberry-pi <user>@<pi>: && ssh <user>@<pi> 'sudo bash raspberry-pi/setup.sh'`
2. Buat `mqtt.conf` (Step 4), `sudo sjk-report`, `sjk-health` → `Lapor MQTT: ... OK 52.1C`.
3. Supabase: `device_configs` `node-001` → `pi_temp_c` terisi, `pi_temp_at` baru.
4. Review Focus #1: sementara ubah host di skrip ke `mqtt.invalid`, `sudo sjk-report` → selesai ≤ 20 detik, `sjk-health` menampilkan `GAGAL`. Kembalikan.
5. Review Focus #2: `sudo mv /etc/sijagakali/mqtt.conf /tmp/` → `sudo sjk-report; echo $?` = `0`, `sjk-health` "belum dikonfigurasi". Kembalikan.
6. Dashboard: kartu `node-001` menampilkan suhu; matikan timer 11 menit (`sudo systemctl stop sjk-report.timer`), reload → `—`. Nyalakan lagi.

### Task 5: PR

- [ ] `sijagakali-api`: push `feat/pi-temperature`, buat PR ke `master` (isi: ringkasan, cara jalankan migrasi, uji manual Task 4 Step 7).
- [ ] `sijagakali-app`: push `feat/pi-temperature`, buat PR ke `main` (catatan: aman di-merge sebelum migrasi — fallback select).
- [ ] Urutan deploy di PR: migrasi Supabase → merge api (collector) → merge app → setup Pi.
