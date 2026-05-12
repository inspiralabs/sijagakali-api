# SiJagaAir — API & worker (monorepo)

Layanan backend: **MQTT collector**, **data processing**, **notification gateway** (WhatsApp), dan **REST API** (Fastify). Paket bersama: **`@sijagaair/shared`**.

---

## Deploy cepat (satu mesin / VPS)

### 1. Prasyarat

- **Node.js** LTS (mis. 20.x atau 22.x) dan **npm**
- File **`.env`** di root `sijagaair-api/` (atau per layanan, sesuai cara Anda mengatur variabel — lihat `shared` / `supabase/README.md` untuk daftar variabel)
- **notification-gateway** memakai **whatsapp-web.js** (Puppeteer): di Linux biasanya perlu dependensi Chromium sistem; pastikan RAM cukup (~512MB+ per proses)

### 2. Instal & build & jalan

Dari folder **`sijagaair-api/`**:

```bash
npm ci
npm run build:start
```

- **`npm run build`** — mengompilasi `shared` lalu `tsc` ke folder `dist/` di tiap workspace.
- **`npm run start`** — menjalankan keempat proses sekaligus dengan `concurrently` (sama seperti pola `dev`, tapi mode produksi `node dist/index.js`).

Untuk **hanya build** atau **hanya start** (setelah pernah build):

```bash
npm run build
npm run start
```

### 3. Produksi yang disarankan

Untuk server sungguhan, lebih aman memakai **systemd**, **PM2**, atau **Docker** supaya proses **restart otomatis** jika crash. Perintah `npm run start` di atas cocok untuk uji di VPS atau sebagai satu proses induk; untuk SLA tinggi, jalankan tiap workspace sebagai unit layanan terpisah, misalnya:

```bash
npm -w mqtt-collector run start
npm -w data-processing run start
npm -w notification-gateway run start
npm -w api run start
```

(masing-masing di unit systemd/PM2 sendiri.)

---

## Skrip npm (root)

| Skrip | Fungsi |
|--------|--------|
| `npm run dev` | Pengembangan: build `shared` lalu jalankan keempat layanan mode watch/tsx |
| `npm run build` | Kompilasi semua workspace ke `dist/` |
| `npm run start` | Jalankan keempat layanan dari `dist/` (wajib sudah `build`) |
| `npm run build:start` | **Build lalu start** — alur paling singkat setelah clone |
| `npm run build:shared` | Hanya build paket `shared` |
| `npm run seed:admin` | Seed admin (butuh konfigurasi DB/env) |

---

## Frontend (dashboard)

Repo terpisah: **`../sijagaair-app`**.

```bash
cd ../sijagaair-app
npm ci
npm run build
```

Hasil di **`dist/`** — deploy sebagai situs statis (Nginx, S3+CloudFront, Vercel, dll.). Set **`VITE_SIJAGAAIRAPI_URL`** ke URL publik API Anda saat build.

---

## Dokumentasi lain

- Skema DB & migrasi: `supabase/README.md`
- Fitur sistem (bahasa mudah): `../plans/SiJagaAir-Fitur-dan-Contoh-Kasus.md`

---

## Jalankan dengan PM2

```bash
cd sijagaair-api
npm ci
npm run build
pm2 start ecosystem.config.cjs
pm2 save
```

Kelola proses:

```bash
pm2 ls
pm2 logs
pm2 restart ecosystem.config.cjs
pm2 stop ecosystem.config.cjs
```
