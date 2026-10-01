# CCTV Live + Snapshot, Broker MQTT VPS, Uji E2E, Deploy OTA — Design

**Source notes:** Brainstorming 2026-10-01. Audit status `sijagakali-api` +
permintaan: CCTV Hikvision untuk live monitoring dan snapshot → Supabase
Storage → WA Channel (gambar + teks), uji MQTT dari ESP32, deploy OTA ke VPS.

## Goal

1. Notifikasi WA otomatis dari data sensor asli benar-benar terkirim
   (sekarang tidak pernah — lihat "Temuan audit").
2. ESP32 di lapangan terkoneksi ke broker MQTT di VPS, terbukti end-to-end
   sampai pesan WA.
3. CCTV Hikvision bisa ditonton live di dashboard publik, dan setiap
   notifikasi WA menyertakan snapshot kamera (disimpan di Supabase Storage).
4. `sijagakali-ota` jalan di VPS dan satu kali update firmware lewat OTA
   terbukti berhasil (dan gagal dengan aman).

## Temuan audit (2026-10-01, dasar desain ini)

| # | Temuan | Bukti |
|---|---|---|
| 1 | `notifEmitter` = `EventEmitter` in-process, tapi `data-processing` dan `notification-gateway` jalan di container/proses terpisah → event `notify` tidak pernah sampai. Hanya `/send-test` (HTTP) yang jalan. | `shared/src/notifEmitter.ts`, `docker-compose.yml`, `ecosystem.config.cjs` |
| 2 | Tidak ada broker di `docker-compose.yml`; `.env` `MQTT_BROKER_URL=mqtt://localhost:1883` (di container = container itu sendiri). | `docker-compose.yml`, `.env` |
| 3 | `mqtt.inspiralabs.id` (72.62.125.210) hanya buka 8883; firmware pakai `wss://.../mqtt` → tidak bisa konek. Broker itu tidak dipakai lagi (keputusan user). | probe TCP, `sijagakali-firmware/src/main.cpp:23` |
| 4 | Jalur CCTV backend menunggu JPEG via MQTT `cctv/image`, firmware ESP32-C5 tidak punya kamera → jalur ini tidak pernah terisi. | `mqtt-collector/src/index.ts`, `sijagakali-firmware/src/main.cpp` |
| 5 | `sijagakali-ota` belum punya Dockerfile/compose, belum di-deploy; MQTT client-nya konek tanpa username/password. | `sijagakali-ota/src/mqttClient.ts` |
| 6 | ACL `pattern readwrite sijagakali/%u/#` membolehkan device publish ke `command` miliknya. | `sijagakali-firmware/mosquitto-conf/sijagakali.acl.txt` |

Yang sudah jalan: API live di `https://api-sijagakali.inspiralabs.id`
(health 200), ingestion → `sensor_readings`, policy notifikasi, gateway WA
gambar+caption, REST admin, firmware mendukung `ota_update`.

## Kondisi lapangan (dari user)

- Kamera: **Hikvision DS-2CD1041G2-LIUF** (4MP, PoE/LAN, RTSP, ISAPI).
- Internet lokasi: **router 4G kartu GSM**, kuota **1 TB / tahun (±83 GB/bulan)**,
  diasumsikan CGNAT (tanpa IP publik).
- Perangkat 24 jam di lokasi: **Raspberry Pi**, satu LAN dengan kamera.
- Live video: **publik** (dashboard `/public`), dengan auto-stop.

## Arsitektur

```
[Lokasi]                                     [VPS, docker network `edge`]
Hikvision ──LAN── Raspberry Pi               mediamtx ──HLS──▶ Traefik ──▶ sijagakali-app (live)
                  (Tailscale subnet ◀─tailnet─▶ │ tarik RTSP ch.102 hanya saat ada penonton
                   router)                       │
ESP32 ──4G── wss://mqtt-sijagakali.inspiralabs.id ─▶ Traefik ─▶ mosquitto:9001
                                                 mosquitto:1883 ◀── mqtt-collector, api, sijagakali-ota
                                                 mqtt-collector → data-processing
                                                     │ shouldNotify() = true
                                                     ├─ captureSnapshot() ──ISAPI (tailnet)──▶ kamera
                                                     │     JPEG → Storage `cctv-images`
                                                     └─ POST notification-gateway:3101/notify
                                                           → WA Channel gambar + teks
```

### Anggaran kuota lokasi (per bulan)

| Pemakaian | Estimasi |
|---|---|
| MQTT sensor + heartbeat | < 0.1 GB |
| Snapshot (±400 KB × ±300) | ±0.1 GB |
| Live sub stream 512 kbps | ±230 MB/jam → ±300 jam/bulan maksimum |

Banyak penonton = satu tarikan dari lokasi (MediaMTX fan-out). Penonton
"lupa tutup tab" dibatasi oleh auto-stop 5 menit di player.

## Komponen

### A. Prasyarat — perbaiki bus notifikasi

- **Hapus** `shared/src/notifEmitter.ts` dan ekspornya.
- **Baru** `shared/src/notifyGateway.ts`:
  `notifyGateway(event: NotificationEvent): Promise<boolean>` →
  `POST ${ENV.GATEWAY_URL}/notify` (JSON), timeout 10 s, `false` + log
  bila gagal (tidak throw).
- `data-processing/src/index.ts`: ganti `notifEmitter.emit` dengan
  `await notifyGateway(event)`. Reading tetap tersimpan walau gateway mati.
- `notification-gateway/src/index.ts`: `POST /notify` → validasi minimal
  (`reading_id`, `device_id`, `water_status` valid) → `processNotification()`
  yang sudah ada; balas `202` tanpa menunggu WA terkirim.
- `docker-compose.yml`: `data-processing` dapat
  `GATEWAY_URL: http://notification-gateway:3101`.

### B. Broker MQTT di VPS

- Service `mosquitto` (`eclipse-mosquitto:2`) di `docker-compose.yml`:
  - listener `1883` (MQTT) — hanya jaringan docker, tidak di-expose Traefik.
  - listener `9001` (websockets) — Traefik router
    `Host(mqtt-sijagakali.inspiralabs.id)` → TLS diterminasi Traefik.
  - `allow_anonymous false`, `password_file`, `acl_file`, volume
    `mosquitto-data` (persistence) + bind `deploy/mosquitto/`.
- `deploy/mosquitto/mosquitto.conf` + `deploy/mosquitto/acl` (pwfile
  **tidak** di-commit; dibuat di VPS dengan `mosquitto_passwd`).
- ACL diperketat per arah:
  ```
  user sijagakali-backend
  topic readwrite sijagakali/#

  pattern write sijagakali/%u/sensor/#
  pattern write sijagakali/%u/cctv/#
  pattern write sijagakali/%u/command/ack
  pattern read  sijagakali/%u/command
  pattern read  sijagakali/%u/config/#
  ```
- `.env` VPS: `MQTT_BROKER_URL=mqtt://mosquitto:1883`,
  `MQTT_USERNAME=sijagakali-backend`.
- Firmware: `MQTT_BROKER_URI "wss://mqtt-sijagakali.inspiralabs.id/mqtt"`
  (satu baris; kredensial device tetap di `main.cpp` seperti sekarang).

### C. CCTV

- **Migrasi** `supabase/migrations/20261001120000_device_configs_cctv_host.sql`:
  `ALTER TABLE sijagakali.device_configs ADD COLUMN IF NOT EXISTS cctv_host text;`
- **Env** (`shared/src/env.ts`): `CCTV_USERNAME`, `CCTV_PASSWORD`,
  `CCTV_SNAPSHOT_TIMEOUT_MS` (default 8000).
- **`shared/src/cctvSnapshot.ts`**:
  - `cctvStoragePath(slug, deviceId, now): string` →
    `{slug}/{deviceId}/{YYYY-MM-DD}/{unix_ts}_{deviceId}.jpg` (format yang
    sudah dipakai collector; collector ikut memakai fungsi ini).
  - `fetchHikvisionSnapshot(host): Promise<Buffer>` →
    `GET http://{host}/ISAPI/Streaming/channels/101/picture` dengan HTTP
    Digest auth (implementasi sendiri pakai `node:crypto`, tanpa dependensi
    baru), timeout dari env, tolak bila `content-type` bukan `image/jpeg`.
  - `captureSnapshot({ host, deploymentSlug, deviceId }): Promise<string | null>`
    → fetch → upload ke bucket → kembalikan path; `null` + log
    `cctv_snapshot_failed` bila gagal di langkah mana pun.
- **data-processing**: `getDeviceConfig` ikut select `cctv_host`. Bila
  `notify` true, `cctv_host` ada, dan tidak ada `cctvRow` dari MQTT →
  `captureSnapshot` → `UPDATE sensor_readings SET cctv_image_path, cctv_captured_at`
  → path masuk `event.cctv_image_path`.
- **api**:
  - `POST /api/cctv/:deviceId/snapshot` (admin, body `deployment_slug?`) →
    `captureSnapshot` → `{ path, signedUrl }`; `502` bila kamera gagal,
    `404` bila device tidak punya `cctv_host`.
  - `device.ts` create/patch menerima `cctv_host` (string trim, kosong → null).
- **MediaMTX** (`bluenviron/mediamtx`), `deploy/mediamtx.yml`:
  - `rtsp: no`, `rtmp: no`, `webrtc: no`, `srt: no`, `api: no`, `hls: yes`,
    `hlsVariant: mpegts` (paling kompatibel), `hlsAllowOrigin` = origin
    dashboard.
  - `authInternalUsers`: user `any` hanya `read` (publik, sesuai keputusan);
    tidak ada `publish`.
  - Path statis per kamera: `cam-{device_id}` →
    `source: rtsp://{user}:{pass}@{cctv_host}:554/Streaming/Channels/102`,
    `rtspTransport: tcp`, `sourceOnDemand: yes`,
    `sourceOnDemandCloseAfter: 10s`. Kredensial lewat env
    (`MTX_PATHS_CAM_..._SOURCE`), bukan di file ter-commit.
  - Traefik: `Host(cctv-sijagakali.inspiralabs.id)` → port 8888.
  - `stream_playback_url` device diisi
    `https://cctv-sijagakali.inspiralabs.id/cam-{device_id}/index.m3u8`.
- **Kamera** (setting manual, didokumentasikan): sub stream `102` codec
  **H.264**, 640×360 atau 1280×720, ±512 kbps CBR; user khusus ber-hak
  "Remote: Live View" saja.
- **Jaringan** (`deploy/cctv-network.md`):
  - Raspberry Pi: `tailscale up --advertise-routes=<LAN kamera>/24`, IP
    forwarding aktif; route disetujui di admin Tailscale.
  - VPS host: `tailscale up --accept-routes` + aturan NAT agar container
    docker bisa menjangkau subnet kamera
    (`iptables -t nat -A POSTROUTING -o tailscale0 -j MASQUERADE`, dipersist).
    **Harus diverifikasi di VPS** dengan `docker run --rm curlimages/curl`
    ke ISAPI kamera sebelum task CCTV lain dianggap selesai.
- **sijagakali-app** (repo terpisah): komponen player `hls.js` di kartu
  device — tombol Play (tidak autoplay), auto-stop setelah 5 menit dengan
  tombol "Lanjut menonton", poster = snapshot terakhir, pesan "Kamera
  offline" bila manifest error. Admin: field `cctv_host` + tombol
  "Ambil snapshot".

### D. OTA di VPS

- `sijagakali-ota/src/mqttClient.ts`: kirim `MQTT_USERNAME`/`MQTT_PASSWORD`.
- `sijagakali-ota/Dockerfile` multi-stage dengan dua target: `backend`
  (Node 22, `node dist/server.js`) dan `frontend` (`nginx-unprivileged`
  menyajikan `frontend/dist`). `sijagakali-ota/docker-compose.yml` di network
  `edge`: Traefik `Host(ota-sijagakali.inspiralabs.id) && PathPrefix(/api)`
  → backend, sisanya → frontend; broker `mqtt://mosquitto:1883`.
- Migrasi tabel OTA (`firmware_releases`, `firmware_updates`) dicek sudah
  ada di Supabase produksi; jalankan bila belum.

### E. Uji end-to-end (`deploy/e2e-checklist.md`)

1. `esp32-dummy` (laptop) → `wss://mqtt-sijagakali...` user `node-001` →
   baris di `mqtt_ingestion` & `sensor_readings`, `last_seen_at` ter-update.
2. Dummy level > ambang waspada → `notification_logs.status = sent`, pesan
   WA masuk Channel (membuktikan perbaikan A).
3. Sama, dengan `cctv_host` terisi → WA berisi gambar + teks, file ada di
   Storage, `sensor_readings.cctv_image_path` terisi.
4. ESP32-C5 asli (flash USB dengan URI baru) → ulang 1–2.
5. Negatif: password salah ditolak; `node-001` publish ke
   `sijagakali/node-002/...` ditolak; `node-001` publish ke
   `sijagakali/node-001/command` ditolak.
6. Live: buka dashboard publik → video main ≤ 10 s; tutup → dalam ±70 s
   MediaMTX log menutup source.
7. OTA: `FIRMWARE_VERSION "sijagakali-v1.0.1"` → upload `.bin` di dashboard
   OTA → deploy ke `node-001` → ack `ok`, reboot, `firmware_version` di
   `device_configs` = v1.0.1. Negatif: URL `.bin` rusak → ack `ok:false`,
   device tetap v1.0.1 dan tetap kirim data.

## Penanganan error

| Kondisi | Perilaku |
|---|---|
| Kamera/Pi/tailnet down saat notifikasi | Snapshot `null`, WA tetap terkirim teks saja, log `cctv_snapshot_failed`. Tidak ada retry snapshot. |
| Upload Storage gagal | Sama seperti di atas. |
| Gateway mati saat `/notify` | `notifyGateway` → `false` + log error; reading tetap tersimpan; tidak ada antrian. |
| Kamera offline saat live | MediaMTX gagal buka source → player tampilkan "Kamera offline" + snapshot terakhir. |
| Broker mati | Perilaku reconnect yang sudah ada (`reconnectPeriod: 3000`). |

## Pengujian otomatis

Pakai `node:test` + `tsx` (tanpa framework baru):
- `cctvSnapshot`: header Digest yang benar terhadap server HTTP palsu
  (401 + `WWW-Authenticate` → 200 JPEG), timeout, content-type salah,
  format `cctvStoragePath`.
- `notifyGateway`: POST ke server palsu; gateway mati → `false` tanpa throw.
- Gateway `POST /notify`: body tidak valid → 400; valid → 202 dan
  `processNotification` terpanggil.

## Keputusan desain

- **Tailscale + MediaMTX on-demand**, bukan push 24 jam dari Pi: push
  sub stream ±300 GB/bulan > kuota ±83 GB/bulan.
- **Port forwarding / Hik-Connect ditolak**: butuh IP publik (CGNAT) dan
  mengekspos kamera Hikvision ke internet; Hik-Connect tidak punya API
  stream untuk backend pihak ketiga.
- **ESP32 bukan jembatan video**: tidak cukup kuat.
- **HLS, bukan WebRTC**: tanpa port UDP tambahan di VPS, jalan di iOS;
  latensi ±3–6 s cukup untuk monitoring sungai.
- **Snapshot via ISAPI, bukan ffmpeg dari stream**: satu request JPEG,
  tidak menyalakan stream, hemat kuota.
- **Bus notifikasi via HTTP** ke gateway: pola `GATEWAY_URL` sudah ada
  (`/send-test`, `/invalidate-template`).
- **Path MediaMTX statis**: cukup untuk 1–beberapa kamera; pindah ke API
  MediaMTX dinamis bila kamera puluhan.
- **Broker di compose VPS (mosquitto)**: broker lama 72.62.125.210 tidak
  dipakai.

## Out of scope

- Rekaman/playback video (NVR), deteksi objek/AI.
- Auth live video (keputusan: publik).
- Antrian/retry notifikasi persisten.
- OTA staged rollout, checksum/MD5, OTA di `sijagakali-app`.
- Provisioning WiFi/MQTT firmware tanpa reflash.
- Monitoring kuota otomatis.
