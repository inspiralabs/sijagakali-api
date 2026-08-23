# Menu "Mock Data" di Admin — Design

**Source notes:** Diskusi brainstorming 2026-08-23, lanjutan dari fitur
warga terdampak banjir (lihat `2026-08-15-warga-terdampak-banjir-design.md`).

## Goal

Admin butuh cara cepat menampilkan data contoh saat presentasi ke
stakeholder (pejabat desa/BPBD), tanpa menunggu kejadian banjir asli:

1. Uji notifikasi WhatsApp status "waspada".
2. Membuat grafik/monitoring dashboard terlihat "hidup" (naik real-time).
3. Data warga terdampak banjir contoh untuk ditunjukkan di halaman
   Warga Terdampak.

## Scope

Satu halaman admin baru `Mock Data` (`/admin/mock-data`) dengan 3 tab, di
`sijagakali-app`. Backend baru terbatas pada 3 endpoint kecil di
`sijagakali-api` untuk tab grafik saja — dua tab lainnya murni memanggil
endpoint yang sudah ada (notification test dari fitur lama, dan
wilayah/banjir/warga dari fitur warga-terdampak-banjir).

**Tidak ada migrasi baru** — fitur ini tidak butuh tabel baru. Semua data
demo memakai tabel yang sudah ada (`mqtt_ingestion`, `sensor_readings`,
`wilayah_dusun/rw/rt`, `banjir_events`, `warga_terdampak`).

**Out of scope:**
- Demo device terpisah (dipertimbangkan lalu ditolak — lihat "Keputusan
  desain" di bawah).
- Persistensi status demo lintas restart server (in-memory saja, cukup
  untuk kebutuhan presentasi sekali jalan).
- Mendukung lebih dari satu sesi demo grafik aktif bersamaan.

## Keputusan desain (dan alasan yang sudah didiskusikan)

- **Device asli, bukan device demo terpisah.** Sudah didiskusikan
  risikonya (warga yang buka dashboard publik pas demo bisa lihat status
  palsu) dan pengguna secara eksplisit memilih tetap pakai device asli
  dengan syarat 3 mitigasi: banner "MODE DEMO AKTIF", auto-stop, dan
  dialog konfirmasi eksplisit sebelum mulai.
- **Demo grafik memicu notifikasi WA asli** — bukan 2 kontrol terpisah.
  Pengguna secara eksplisit minta simulasi penuh: begitu level demo
  melewati ambang waspada, WA asli terkirim ke channel produksi, sama
  seperti kejadian asli.
- **Reuse pipeline asli, jangan reimplementasi anti-spam.** Alih-alih
  insert langsung ke `sensor_readings` (yang melewati notifikasi sama
  sekali), demo grafik insert ke `sijagakali.mqtt_ingestion` — staging
  table yang sama dipakai device asli. `data-processing` (service yang
  sudah jalan di produksi) otomatis memprosesnya lewat jalur asli:
  `calcWaterStatus()` → insert `sensor_readings` → `shouldNotify()` → WA
  jika perlu. Tidak ada logika notifikasi baru yang ditulis ulang.
- **Kenaikan halus, lalu rata (flat hold), bukan penjagaan anti-spam
  buatan.** `shouldNotify()` (lihat
  `data-processing/src/notificationPolicy.ts`) punya 2 pemicu relevan:
  (1) perubahan status, sekali saja saat naik dari normal→waspada, dan
  (2) "lonjakan cepat" — delta kumulatif dalam jendela waktu bergulir
  (`notify_surge_window_min`) melebihi `notify_surge_delta_cm`. Dengan
  menaikkan level secara linear lalu **menahannya benar-benar rata**
  (nilai identik, tanpa jitter) setelah mencapai target, delta kumulatif
  jadi nol selamanya setelah itu — pemicu (2) tidak akan pernah menyala
  lagi, dan pemicu (1) cuma menyala sekali. Cooldown re-notifikasi
  (pemicu status-sama) butuh waktu cooldown penuh berlalu sementara
  status tidak berubah — untuk sesi demo maks. 15 menit, ini secara
  praktis tidak akan kejadian untuk pengaturan cooldown yang wajar.
  **Hasil: tepat satu notifikasi WA nyata per sesi demo, terjamin oleh
  bentuk kurva data, bukan oleh guard tambahan.**

## Arsitektur

### Tab 1: Notifikasi (wrapper, tanpa backend baru)

Form: pilih device, pilih `water_status` (default `waspada`), level air,
toggle CCTV, teks pesan opsional. Dua tombol:
- **Pratinjau** — panggil `POST /api/notification/test` dengan `send:
  false` (endpoint sudah ada, lihat `api/src/routes/notification.ts`).
  Tampilkan `preview` dari response di kartu read-only.
- **Kirim ke WhatsApp (Asli)** — sama tapi `send: true`, di belakang
  dialog konfirmasi: *"Ini akan mengirim pesan asli ke channel WhatsApp
  produksi. Lanjutkan?"*

### Tab 2: Grafik Realtime (backend baru)

**Backend — `api/src/routes/mockData.ts`** (baru), state in-memory (tidak
persisten, hilang saat restart — bisa diterima untuk fitur demo):

```typescript
interface ChartDemoSession {
  deploymentSlug: string;
  deviceId: string;
  correlationIds: string[];   // dilacak untuk cleanup saat stop
  tickTimer: NodeJS.Timeout;
  stopTimer: NodeJS.Timeout;  // auto-stop
  currentLevel: number;
  targetLevel: number;
  step: number;
  startedAt: number;
}

let activeSession: ChartDemoSession | null = null;
```

- `POST /api/mock-data/chart/start` (`requireAdmin`), body
  `{ device_id: string; deployment_slug: string }`:
  - 409 jika `activeSession` sudah ada ("Demo sedang berjalan untuk
    device lain, hentikan dulu.").
  - Ambil `device_configs` untuk device ini: `threshold_waspada_cm`.
  - `baseline = Math.max(0, threshold_waspada_cm - 10)`,
    `target = threshold_waspada_cm + 3`,
    `step = (target - baseline) / 12` (~12 tick, interval 5 detik →
    ramp ~1 menit sebelum rata).
  - Mulai `setInterval` 5 detik: tiap tick, `currentLevel = min(target,
    currentLevel + step)`; generate `correlation_id` baru (UUID);
    `INSERT INTO sijagakali.mqtt_ingestion (deployment_slug, device_id,
    correlation_id, message_type, payload_json, ingest_status) VALUES
    (..., 'sensor_data', jsonb_build_object('water_level_cm',
    currentLevel, 'timestamp', now()), 'parsed_ok')`; simpan
    `correlation_id` ke `session.correlationIds`.
  - Mulai `setTimeout` 15 menit yang memanggil logika stop yang sama
    seperti endpoint stop (auto-stop).
  - Simpan sesi ke `activeSession`, balas `{ ok: true }`.
- `POST /api/mock-data/chart/stop` (`requireAdmin`):
  - Jika tidak ada `activeSession`, balas `{ ok: true }` (idempotent).
  - `clearInterval`/`clearTimeout` kedua timer.
  - `DELETE FROM sensor_readings WHERE correlation_id = ANY(session.correlationIds)`
  - `DELETE FROM mqtt_ingestion WHERE correlation_id = ANY(session.correlationIds)`
  - **Jangan hapus `notification_logs`** — kalau WA sungguhan terkirim
    saat demo, itu tetap harus tercatat di audit trail.
  - `activeSession = null`, balas `{ ok: true }`.
- `GET /api/mock-data/chart/status` (**publik, tanpa `requireAdmin`** —
  hanya info non-sensitif, dibaca dashboard publik tanpa login): balas
  `{ active: boolean; device_id: string | null; deployment_slug: string
  | null }`.

**Frontend — tab di `MockData.tsx`:** dropdown device, status "Aktif —
sisa ~X menit" / "Tidak aktif" (dihitung dari `startedAt` + 15 menit),
tombol Mulai (di belakang dialog konfirmasi: *"Ini akan menampilkan
status air palsu di dashboard PUBLIK untuk pos ini selama maks. 15
menit, dan akan mengirim notifikasi WhatsApp ASLI ke channel produksi
kalau levelnya melewati ambang waspada — lanjutkan?"*) dan tombol
Hentikan.

**Banner keselamatan — `components/DemoModeBanner.tsx`** (baru): polling
`GET /api/mock-data/chart/status` tiap 5 detik; kalau `active`,
tampilkan banner tetap di atas halaman: *"⚠️ MODE DEMO AKTIF — data
tidak mencerminkan kondisi asli."* Dipasang di `Dashboard.tsx` (admin)
dan `PublicDashboard.tsx` (publik) — dua tempat, komponen yang sama.

### Tab 3: Warga Terdampak (wrapper, tanpa backend baru)

Tombol **"Isi Data Contoh"**: cek dulu via Supabase read apakah wilayah
`[DEMO] ...` dan kejadian `"Banjir Demo"` sudah ada (idempotent, aman
diklik berkali-kali); kalau belum, buat lewat endpoint yang sudah ada:
- 2 dusun `[DEMO] Dusun A`, `[DEMO] Dusun B` lewat `POST
  /api/wilayah/dusun`.
- 1 RW + 1 RT per dusun lewat `POST /api/wilayah/rw` /
  `POST /api/wilayah/rt`.
- 1 kejadian banjir `"Banjir Demo"` (`tanggal_mulai` = hari ini) lewat
  `POST /api/banjir/events`.
- ~6 baris warga contoh (nama, NIK dummy 16-digit, campuran status
  `di_rumah`/`mengungsi`, tersebar di 2 dusun) lewat
  `POST /api/banjir/warga`.

Tombol **"Hapus Data Contoh"**: cari `banjir_events` bernama `"Banjir
Demo"` lewat Supabase read, `DELETE /api/banjir/events/:id` (cascade
menghapus warga-nya lewat `ON DELETE CASCADE` yang sudah ada di skema).
Lalu best-effort `DELETE` tiap wilayah `[DEMO] ...`, **urutan anak dulu
baru induk** (RT → RW → Dusun) karena FK-nya `ON DELETE RESTRICT` —
kalau dibalik, hapus Dusun akan gagal duluan selama RW/RT anaknya masih
ada. Kalau satu langkah gagal karena 409 (masih dipakai data lain di
luar seed ini), tampilkan pesan error yang sudah ada dari endpoint
wilayah dan lanjutkan ke langkah berikutnya, jangan retry otomatis.

## Data flow ringkas (tab grafik)

```
Admin klik "Mulai" (pilih device asli)
        │
        ▼
POST /api/mock-data/chart/start ──► setInterval 5s, 12 tick naik linear
        │                                  │
        │                                  ▼
        │                     INSERT mqtt_ingestion (sensor_data, parsed_ok)
        │                                  │
        │                                  ▼
        │                  data-processing (realtime/poll, TIDAK DIUBAH)
        │                                  │
        │                     calcWaterStatus() → INSERT sensor_readings
        │                                  │
        │                     shouldNotify() → true sekali saat lintas waspada
        │                                  │
        │                                  ▼
        │                     notifEmitter → notification-gateway → WA asli
        │
        ▼
Dashboard admin & publik: Supabase Realtime pada sensor_readings ─► chart naik
DemoModeBanner (poll tiap 5s ke /chart/status) ─► banner tampil selama aktif
        │
Admin klik "Hentikan" (atau auto-stop 15 menit)
        │
        ▼
DELETE sensor_readings & mqtt_ingestion (by correlation_id) ─► histori bersih
notification_logs TETAP ADA (audit trail pesan yang sungguh terkirim)
```

## Keterbatasan yang diterima (bukan bug, sengaja tidak ditangani)

- State demo di memori proses `api` — restart server saat demo aktif
  akan meninggalkan baris `mqtt_ingestion`/`sensor_readings` yang sudah
  terlanjur masuk tanpa cleanup otomatis. Untuk fitur presentasi
  sekali-jalan, ini diterima; tidak dibangun mekanisme recovery.
- Kalau level air device asli saat ini sudah di atas ambang waspada,
  ramp demo langsung "meloncat" secara status sejak tick pertama.
  Kejadian jarang (device real-time semestinya sudah di status normal
  saat presentasi dijadwalkan) dan tidak di-guard khusus.
- Hanya 1 sesi demo grafik aktif dalam satu waktu (di seluruh sistem,
  bukan per-admin) — cukup untuk kebutuhan satu presentasi.

## Testing approach

Mengikuti pola fitur warga-terdampak-banjir: tidak ada suite test
otomatis untuk endpoint baru ini (proyek belum punya kebiasaan test API
di `sijagakali-api/api/src`). Verifikasi manual: `curl` untuk 3 endpoint
baru (start/stop/status), lalu klik-uji end-to-end di browser dengan
`data-processing` dan `notification-gateway` berjalan.
