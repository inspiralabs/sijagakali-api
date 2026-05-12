# Supabase — migrasi schema SiJagaAir

Semua tabel aplikasi berada di schema Postgres **`sijagaair`**. Multi-wilayah tetap lewat kolom **`deployment_slug`** (bukan schema terpisah per desa).

## Isi folder

| File | Keterangan |
|------|------------|
| `migrations/20260209120000_init_sijagaair_core.sql` | `CREATE SCHEMA sijagaair` + tabel, trigger, Realtime, grant, RLS |
| `migrations/20260209120100_seed_bojong_kulur_dev.sql` | Seed opsional Bojong Kulur |
| `migrations/20260210140000_drop_legacy_public_tables.sql` | Template opsional untuk buang salinan lama di `public` (default no-op) |
| `migrations/20260211120000_device_configs_stream_playback_url.sql` | Tambah kolom **`stream_playback_url`** (live CCTV) pada DB yang sudah pernah di-init tanpa kolom ini |
| `migrations/20260512100000_reinforce_anon_read_devices_readings.sql` | Pastikan role **`anon`** punya GRANT + policy SELECT untuk dashboard **`/public`** |
| `migrations/20260512120000_authenticated_read_dashboard_tables.sql` | Policy SELECT role **`authenticated`** untuk `deployments`, `device_configs`, `sensor_readings` (dashboard admin setelah login) |

## Kenapa sempat “publik ada data, admin kosong”?

**Row Level Security (RLS)** di Postgres mengecek **peran JWT** (`anon` vs `authenticated`), bukan sekadar `GRANT`.

- Policy SELECT di init awal hanya ditulis untuk **`anon`** pada beberapa tabel dashboard.
- Setelah aplikasi menunggu sesi login selesai, request memakai JWT **`authenticated`**. Tanpa policy SELECT untuk peran itu, PostgREST mengembalikan **0 baris** — bukan error yang selalu terlihat di UI.
- **Bukan bug deploy server**: ini murni **urutan + isi migrasi** di database Supabase yang kamu pakai.

## Migrasi tambahan: `stream_playback_url` (live CCTV)

- **Instalasi baru:** kolom sudah termasuk di `20260209120000_init_sijagaair_core.sql`.
- **Instalasi lama:** jalankan `20260211120000_device_configs_stream_playback_url.sql` sekali (aman `IF NOT EXISTS`).

## Wajib setelah migrasi: expose schema di API

Supabase **PostgREST** hanya melayani schema yang diizinkan:

1. Dashboard → **Project Settings** → **Data API** (atau **API** → *Exposed schemas*).
2. Tambahkan **`sijagaair`** ke daftar schema yang di-expose (selain `public` jika perlu).
3. Simpan.

Tanpa langkah ini, client `supabase-js` dengan `db: { schema: 'sijagaair' }` akan mendapat error saat query.

## Client TypeScript (ringkas)

```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  { db: { schema: 'sijagaair' } }
)
```

## Cara menjalankan migrasi

**Penting saat deploy:** memasang **frontend/backend ke VPS** tidak otomatis mengubah schema Postgres. Migrasi selalu dijalankan **ke database** (biasanya proyek **Supabase Cloud**), satu kali per environment (dev / staging / production).

Urutan file mengikuti **awalan timestamp** pada nama file (`20260209…` dulu, lalu `20260511…`, dst.). DB yang sudah lama jalan cukup menjalankan **file migrasi baru** yang belum pernah dieksekusi di environment itu.

### Opsi A — Supabase SQL Editor

1. Buka **SQL** → **New query**.
2. Tempel isi file migrasi **berurutan** (atau hanya file yang belum pernah dijalankan di project itu).
3. Jalankan. Ulangi untuk migrasi berikutnya.

Cocok untuk tim kecil atau sekali setup production.

### Opsi B — `psql` (dari mesin lokal atau CI)

Gunakan **connection string direct** Postgres (host `db.<project-ref>.supabase.co`, bukan URL pooler jika ada masalah DDL), misalnya variabel `DIRECT_URL` atau `DATABASE_URL`.

```powershell
cd d:\code-for-life\projects\ews-bojong-kulur\sijagaair-api
# Hanya untuk DB kosong / clone baru. Jangan loop semua file ke production yang sudah di-init (CREATE akan bentrok).
Get-ChildItem supabase\migrations\*.sql | Sort-Object Name | ForEach-Object { psql "$env:DIRECT_URL" -v ON_ERROR_STOP=1 -f $_.FullName }
```

Di Linux/macOS setara: `for f in supabase/migrations/*.sql; do psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f "$f"; done` (pastikan urutan nama file benar).

**CI/CD (GitHub Actions, dll.):** simpan `DIRECT_URL` (atau connection string) di **secret** repositori, jalankan langkah di atas pada pipeline saat deploy / saat merge ke branch production — **bukan** di server static hosting yang hanya menyajikan file HTML.

### Opsi C — Supabase CLI (`supabase db push`)

Jika repositori sudah di-`supabase link` ke project dan memakai workflow resmi Supabase, `supabase db push` menerapkan folder `migrations/` ke project terhubung. Butuh `config.toml` + login CLI; folder ini saja bisa dipakai manual tanpa CLI.

### Instal baru vs DB yang sudah jalan

- **Database kosong:** jalankan semua file di `migrations/` **urut nama** (Opsi A, B loop, atau C).
- **Production yang sudah pernah di-init:** hanya jalankan file SQL **baru** yang belum pernah dijalankan di project itu (cek riwayat tim / dokumentasi deploy).

### Jika sebelumnya sudah pakai tabel di `public`

Jalankan isi yang relevan dari `20260210140000_drop_legacy_public_tables.sql` (uncomment dengan hati-hati) **setelah** data aman / backup, lalu expose `sijagaair` seperti di atas.

## Prisma — perlu atau tidak?

- **Prisma Migrate** mengelola schema dari `schema.prisma`. Proyek ini memakai **SQL mentah** untuk fitur khas Supabase: RLS, policy per role, trigger, publication Realtime. Itu semua tetap valid SQL di Postgres; tidak wajib diganti Prisma.
- Memakai **Prisma sebagai ORM** di service Node (query tipe-aman) **boleh**, terpisah dari file migrasi SQL di folder ini — yang penting **satu sumber kebenaran untuk migrasi**: kalau schema diubah, pilih apakah perubahan lewat SQL (`supabase/migrations`) atau lewat Prisma, supaya tidak dobel definisi.
- **“Lebih baik Prisma?”** untuk kasus SiJagaAir + Supabase + RLS: **tetap SQL migrasi (seperti sekarang) biasanya lebih jelas** untuk policy dan audit keamanan. Prisma tidak menghapus kebutuhan memahami RLS; malah sering tim pakai SQL untuk RLS dan Prisma hanya untuk query aplikasi.
- Jika tetap memakai Prisma di sisi app: set `schemas = ["sijagaair"]` (atau `searchPath`) sesuai dokumentasi Prisma + Supabase; `DIRECT_URL` gunakan host **direct** `db.<ref>.supabase.co:5432` untuk migrasi stabil.

## Storage bucket `cctv-images`

Buat bucket privat **`cctv-images`** bila belum ada. Path objek:

`{deployment_slug}/{device_id}/{YYYY-MM-DD}/{unix_ts}_{device_id}.jpg`

## Keamanan

Jangan commit `.env` berisi **service role** atau password DB. Rotasi kredensial jika pernah bocor.
