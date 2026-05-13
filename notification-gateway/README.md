# notification-gateway (WhatsApp)

Layanan Node memakai **whatsapp-web.js** → di bawahnya **Puppeteer** menjalankan **Chromium**. Di Linux server “minimal”, Chromium sering gagal karena **paket library GUI** belum terpasang.

## Error: `libatk-1.0.so.0: cannot open shared object file`

Itu artinya **dependency sistem** untuk Chrome/Chromium belum lengkap, bukan bug TypeScript.

### Opsi A — Pasang dependency untuk Chromium bawaan Puppeteer (Debian / Ubuntu)

Jalankan sebagai root (sesuaikan nama paket jika distro Anda beda; Ubuntu 22.04+ sering pakai sufiks `t64` di beberapa paket):

```bash
sudo apt-get update
sudo apt-get install -y \
  ca-certificates fonts-liberation \
  libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 \
  libc6 libcairo2 libcups2t64 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
  libglib2.0-0t64 libgtk-3-0t64 libnspr4 libnss3 \
  libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 \
  libx11-6 libx11-xcb1 libxcb1 libxcomposite1 libxcursor1 libxdamage1 \
  libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
  wget xdg-utils
```

Jika `apt` mengeluh paket `*t64` tidak ada (mis. Ubuntu 20.04), ganti misalnya:

- `libasound2t64` → `libasound2`
- `libatk1.0-0t64` → `libatk1.0-0`
- `libatk-bridge2.0-0t64` → `libatk-bridge2.0-0`
- `libcups2t64` → `libcups2`
- `libglib2.0-0t64` → `libglib2.0-0`
- `libgtk-3-0t64` → `libgtk-3-0`

Atau pasang meta-paket browser (sering menarik semua dependency):

```bash
sudo apt-get install -y chromium-browser
# atau: chromium (nama paket tergantung distro)
```

Lalu set environment agar gateway memakai Chromium sistem:

```bash
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
# atau: /usr/bin/chromium
npm run dev
```

Variabel yang didukung kode:

- **`PUPPETEER_EXECUTABLE_PATH`** (disarankan)
- **`CHROME_PATH`** (alias)

### Opsi B — Docker

Gunakan image Node berbasis Debian/Ubuntu yang sudah memasang Chromium + dependency, atau tambahkan `RUN apt-get install …` seperti di atas di Dockerfile. Mount volume untuk `.wwebjs_auth` agar sesi WA tidak hilang.

### Opsi C — Headless di VPS kecil

Tambahkan RAM swap jika perlu; Chromium butuh memori. Argumen `--disable-dev-shm-usage` sudah disetel di kode untuk mengurangi masalah `/dev/shm` kecil di container.

---

## Menjalankan

Dari folder **`notification-gateway`** (atau lewat workspace root `sijagaair-api`):

```bash
npm install
npm run dev
```

Produksi: build monorepo lalu `npm run start` (lihat `../README.md` dan `ecosystem.config.cjs`).

Pastikan file **`.env`** (atau env di PM2) berisi variabel yang sama dengan paket `shared` (Supabase, port gateway, WhatsApp channel, dll.).
