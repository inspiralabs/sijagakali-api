# Supabase — migrasi schema SiJagaAir

Semua tabel aplikasi berada di schema Postgres **`sijagaair`**. Multi-wilayah tetap lewat kolom **`deployment_slug`** (bukan schema terpisah per desa).

## Isi folder

| File | Keterangan |
|------|------------|
| `migrations/20260209120000_init_sijagaair_core.sql` | `CREATE SCHEMA sijagaair` + tabel, trigger, Realtime, grant, RLS |
| `migrations/20260209120100_seed_bojong_kulur_dev.sql` | Seed opsional Bojong Kulur |
| `migrations/20260210140000_drop_legacy_public_tables.sql` | Template opsional untuk buang salinan lama di `public` (default no-op) |
| `migrations/20260211120000_device_configs_stream_playback_url.sql` | Tambah kolom **`stream_playback_url`** (live CCTV) pada DB yang sudah pernah di-init tanpa kolom ini |

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

### Opsi A — Supabase SQL Editor

1. Jalankan berurutan: `20260209120000_init_sijagaair_core.sql` lalu `20260209120100_seed_bojong_kulur_dev.sql` (opsional).

### Opsi B — `psql`

```powershell
cd d:\code-for-life\projects\ews-bojong-kulur\sijagaair-api
psql "$env:DIRECT_URL" -f supabase/migrations/20260209120000_init_sijagaair_core.sql
psql "$env:DIRECT_URL" -f supabase/migrations/20260209120100_seed_bojong_kulur_dev.sql
```

### Jika sebelumnya sudah pakai tabel di `public`

Jalankan isi yang relevan dari `20260210140000_drop_legacy_public_tables.sql` (uncomment dengan hati-hati) **setelah** data aman / backup, lalu expose `sijagaair` seperti di atas.

## Storage bucket `cctv-images`

Buat bucket privat **`cctv-images`** bila belum ada. Path objek:

`{deployment_slug}/{device_id}/{YYYY-MM-DD}/{unix_ts}_{device_id}.jpg`

## Prisma

Set `schemas = ["sijagaair"]` (atau `searchPath`) sesuai dokumentasi Prisma + Supabase; `DIRECT_URL` gunakan host **direct** `db.<ref>.supabase.co:5432` untuk migrasi stabil.

## Keamanan

Jangan commit `.env` berisi **service role** atau password DB. Rotasi kredensial jika pernah bocor.
