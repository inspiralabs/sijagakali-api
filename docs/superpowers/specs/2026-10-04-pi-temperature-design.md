# Suhu Raspberry Pi di kartu perangkat — desain

Tanggal: 2026-10-04 · Repo terdampak: `sijagakali-api` (Pi script, migrasi, collector), `sijagakali-app` (dashboard)

## Latar belakang

Kartu perangkat di dashboard menampilkan baterai, sinyal, dan suhu. Hanya sinyal (`rssi` dari ESP32) yang asli:

- **Baterai**: firmware tidak mengirim `battery_pct` (board tanpa sensor baterai) → `null` → tampil `0%` (`fetchDashboard.ts`, `?? 0`).
- **Suhu**: `boxTemp: 0` ditulis mati di `fetchDashboard.ts` → selalu `0°C`.

Angka 0 menyesatkan (baterai habis? 0°C?).

## Keputusan

- **Baterai** ditampilkan `—` sampai ada sensor tegangan (rencana: INA226, tampil tegangan + status, bukan persen — LiFePO4 terlalu datar untuk persen dari tegangan).
- **Suhu** diambil dari **suhu CPU Raspberry Pi** di lokasi (`vcgencmd measure_temp`). Ini suhu chip, bukan udara box; dipakai untuk memantau tren/kepanasan.
- Pi mengirim lewat **MQTT** (opsi A), bukan ditarik server lewat Tailscale (opsi B ditolak: butuh layanan HTTP di Pi + polling + konfigurasi IP per device).

## Asumsi

- Satu lokasi = satu Pi = satu device sensor (`node-001`). Suhu Pi ditampilkan di kartu device itu.
- Pi memakai **akun MQTT device yang sama** dengan ESP32 (`node-001`), karena ACL broker infra mengikat namespace ke username (`sijagakali/<username>/...`) dan device hanya boleh menulis `sensor/#`, `cctv/#`, `command/ack`. Risiko diterima: Pi dan ESP32 berada di lokasi yang sama.

## Desain

### 1. Raspberry Pi (`sijagakali-api/deploy/raspberry-pi/`)

- Skrip baru **`sjk-report`** (bash, dipasang ke `/usr/local/bin/`):
  - baca suhu: `vcgencmd measure_temp` → angka (mis. `52.1`).
  - kirim: `mosquitto_pub -h mqtt.inspiralabs.id -p 8883 --capath /etc/ssl/certs -u $MQTT_DEVICE_ID -P $MQTT_PASSWORD -i sjk-pi-$MQTT_DEVICE_ID -q 1 -t sijagakali/$MQTT_DEVICE_ID/cctv/pi-status -m '{"pi_temp_c":52.1}'`.
  - hasil (waktu + OK/gagal) ditulis ke `/run/sijagakali/last-report` (RAM, tidak menulis microSD).
  - keluar diam bila `/etc/sijagakali/mqtt.conf` belum ada (Pi tetap berfungsi sebagai jembatan kamera).
- Kredensial di **`/etc/sijagakali/mqtt.conf`** (`MQTT_DEVICE_ID`, `MQTT_PASSWORD`), mode `600`, milik root. Tidak di `site.conf`, tidak di repo.
- **`setup.sh`**: pasang `mosquitto-clients`, pasang `sjk-report`, `sjk-report.service` (oneshot) + `sjk-report.timer` (tiap 2 menit, `OnBootSec=1min`, `OnUnitActiveSec=2min`), aktifkan timer. Idempoten seperti langkah lain.
- **`sjk-health`**: tambah baris `Lapor MQTT` dari `/run/sijagakali/last-report` (atau "belum dikonfigurasi" bila `mqtt.conf` tidak ada).
- Panduan `docs/panduan/02-raspberry-pi.md`: cara membuat `mqtt.conf`.

### 2. Backend (`sijagakali-api`)

- **Migrasi** `supabase/migrations/20261004090000_device_configs_pi_temp.sql`:
  `ALTER TABLE sijagakali.device_configs ADD COLUMN IF NOT EXISTS pi_temp_c numeric(5,1), ADD COLUMN IF NOT EXISTS pi_temp_at timestamptz;` (nullable).
- **`shared/src/types.ts`**: `TOPICS.PI_STATUS = 'sijagakali/+/cctv/pi-status'`, tipe `PiStatusPayload { pi_temp_c: number }`.
- **`shared/src/piStatus.ts`**: fungsi murni `parsePiTemp(payload: unknown): number | null` — angka berhingga dalam rentang −20…120, dibulatkan 1 desimal; selain itu `null`.
- **`mqtt-collector`**: subscribe `TOPICS.PI_STATUS`; handler `cctv/pi-status` → `parsePiTemp`; valid → `UPDATE device_configs SET pi_temp_c, pi_temp_at = now (jam server)` berdasarkan `device_id` dari topik dan `DEFAULT_DEPLOYMENT_SLUG`; tidak valid → `console.warn`, tidak menulis.
- Tidak ada perubahan ACL (device sudah boleh menulis `cctv/#`). Routing collector memakai `endsWith`, `/cctv/pi-status` tidak bentrok dengan `/cctv/image`/`/cctv/meta`.

### 3. Dashboard (`sijagakali-app`)

- `fetchDashboard.ts`: konstanta baru `DEVICE_CONFIGS_SELECT_WITH_PI` = `WITH_SNAPSHOT` + `pi_temp_c, pi_temp_at`, dicoba **pertama**; bila kolom belum ada, jatuh ke rantai fallback yang sudah ada (mulai `WITH_SNAPSHOT`, sehingga snapshot tidak ikut hilang); fungsi murni `freshPiTemp(temp, at, now)` → `temp` bila `at` ≤ 10 menit yang lalu, selain itu `null`.
- `types.ts`: `boxTemp: number | null`; `battery` tetap ada (dipakai mock) tapi tidak ditampilkan.
- `DeviceCard.tsx`, `DeviceHealth.tsx`: baterai → `—` (tanpa progress bar); suhu → `${boxTemp}°C` atau `—`.

### Penanganan error

| Kondisi | Hasil |
|---|---|
| Pi mati / tanpa internet / `mqtt.conf` belum ada | Tidak ada kiriman → `pi_temp_at` menua → dashboard `—` setelah 10 menit |
| Payload rusak / di luar rentang | Collector `warn`, kolom tidak berubah |
| Migrasi belum dijalankan | Select `WITH_PI` gagal (missing column) → fallback ke `WITH_SNAPSHOT` → suhu `—`, fitur lain utuh |

## Pengujian

- `shared/src/piStatus.test.ts` (node:test): valid, string angka ditolak, NaN, di luar rentang, objek tanpa field, pembulatan.
- `sijagakali-app`: `freshPiTemp` (vitest): segar, basi, `null`; `npm run build`.
- Pi (manual): `sudo sjk-report` → `sjk-health` menampilkan OK → kolom `pi_temp_c` terisi di Supabase → kartu menampilkan suhu.

## Di luar cakupan

Riwayat/grafik suhu, peringatan WA Pi kepanasan, sensor suhu udara box (DS18B20/AHT20), sensor tegangan baterai (INA226).
