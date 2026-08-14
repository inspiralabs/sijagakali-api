# notification-gateway (WhatsApp)

Layanan Node memakai **whatsapp-web.js** → di bawahnya **Puppeteer** menjalankan **Chromium**. Di Linux server “minimal”, Chromium sering gagal karena **paket library GUI** belum terpasang.

## Error: `libatk-1.0.so.0: cannot open shared object file`

Itu artinya **dependency sistem** untuk Chrome/Chromium belum lengkap, bukan bug TypeScript.

### Pasang dependency untuk Chromium bawaan Puppeteer (Debian / Ubuntu)

Jalankan sebagai root (sesuaikan nama paket jika distro Anda beda; Ubuntu 22.04+ sering pakai sufiks `t64` di beberapa paket):

```bash
sudo apt-get update
sudo apt-get install -y libatk1.0-0 libatk-bridge2.0-0 libgbm1 libgtk-3-0 libnss3 libxss1 libasound2
```

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

---

## Menjalankan

Dari folder **`notification-gateway`** (atau lewat workspace root `sijagakali-api`):

```bash
npm install
npm run dev
```

Produksi: build monorepo lalu `npm run start` (lihat `../README.md` dan `ecosystem.config.cjs`).

Pastikan file **`.env`** (atau env di PM2) berisi variabel yang sama dengan paket `shared` (Supabase, port gateway, WhatsApp channel, dll.).
