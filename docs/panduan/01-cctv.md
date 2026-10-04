# 01 — Setup CCTV (Hikvision DS-2CD1041G2-LIUF)

Kamera dipakai untuk **live video** di dashboard publik dan **snapshot** (saat alarm,
berkala, dan tombol manual admin) yang disimpan ke Supabase Storage lalu dikirim ke WA.
Kamera tidak menyimpan/merekam apa pun — microSD di kamera **tidak diperlukan**.

> Terkait: kamera hanya bisa dijangkau server setelah [02 — Raspberry Pi](02-raspberry-pi.md)
> terpasang. Daftar nilai yang harus sama di beberapa tempat: [README](README.md#peta-kredensial--nilai-yang-saling-terkait).

## Kebutuhan

| Barang | Catatan |
|---|---|
| Kamera Hikvision DS-2CD1041G2-LIUF | 4MP, PoE, RTSP + ISAPI |
| **PoE injector 802.3af** *atau* adaptor **12V DC** | TL-MR100 tidak punya port PoE |
| Kabel LAN Cat5e/Cat6 outdoor | Kamera → PoE injector → port LAN router |
| Laptop di WiFi router | Untuk membuka web admin kamera (setting awal) |
| Rumah kabel / junction box anti air | Sambungan LAN di luar ruangan |

Port router: TL-MR100 punya 2 port LAN (salah satunya LAN/WAN). Satu untuk kamera,
satu untuk Raspberry Pi.

## Langkah

### 1. Aktivasi & masuk web admin
1. Colok kamera ke router lewat PoE injector, tunggu ±1 menit.
2. Cari IP kamera: halaman admin router (`http://192.168.1.1` / `tplinkmodem.net`) →
   daftar perangkat/DHCP clients, atau aplikasi **SADP Tool** Hikvision (Windows).
3. Kamera baru wajib **diaktivasi**: buat password akun `admin` yang kuat (simpan di
   password manager). Akun `admin` ini **tidak** dipakai server.

### 2. IP statis
**Configuration → Network → Basic Settings → TCP/IP**: matikan DHCP, isi:
- IPv4 Address: **`192.168.1.64`** (nilai yang sudah tercatat di dashboard & VPS)
- Subnet mask `255.255.255.0`, Default gateway `192.168.1.1`, DNS `8.8.8.8`

> `.64` berada di luar pool DHCP router (.100–.199) sehingga tidak bentrok. IP lain boleh, tetapi ubah juga di dashboard (CCTV → IP kamera) dan di VPS
> `deploy/mediamtx.yml` — lihat [peta kredensial](README.md#peta-kredensial--nilai-yang-saling-terkait).

### 3. Sub stream untuk live (hemat kuota)
**Configuration → Video/Audio → Video**, Stream Type **Sub Stream**:
- Video Encoding **H.264** (bukan H.265 — browser tidak bisa memutar H.265)
- Resolution **640×360** (atau 640×480), Frame Rate **15**
- Bitrate Type **Constant**, Max Bitrate **512 Kbps**

Main stream (4MP) dibiarkan — dipakai untuk snapshot alarm/manual yang tajam.

### 4. User khusus untuk server
**System → User Management → Add**: level **User**, hak **Remote: Live View** saja.

- **Username harus sama dengan `CCTV_USERNAME` di VPS** — saat ini **`sijagakali`**.
- **Password harus sama dengan `CCTV_PASSWORD` di VPS `.env`** (yang sudah Anda isi).
- Aturan Hikvision: username hanya huruf/angka (tanda `-` ditolak); password 8–16 karakter,
  tidak boleh memuat username. Login pertama user baru **wajib ganti password** di web kamera —
  lakukan sekali, lalu samakan password baru di VPS.
- Kalau ingin username/password lain: ubah di kamera, lalu di VPS ubah `CCTV_USERNAME`/
  `CCTV_PASSWORD` di `/srv/apps/sijagakali-api/.env` **dan** bagian `rtsp://USER:PASS@...`
  di `/srv/apps/sijagakali-api/deploy/mediamtx.yml`.

### 5. Autentikasi & ISAPI
- **System → Security → Authentication**: WEB Authentication **digest**, RTSP Authentication **digest** (bawaan).
- **Network → Advanced → Integration Protocol**: bila ada "Enable ISAPI"/"Hikvision-CGI", aktifkan.

### 6. Timestamp di gambar & jam akurat
- **Configuration → Image → OSD Settings**: centang **Display Date** (24 jam), isi
  **Camera Name** (mis. "Kali Bojong Kulur"). Tanggal/jam tercetak di live dan snapshot.
- **Configuration → System → System Settings → Time Settings**: **NTP** `pool.ntp.org`,
  zona waktu **GMT+07:00**.

### 7. Uji dari laptop (WiFi yang sama)
```bash
curl --digest -u sijagakali:PASSWORD -o snap.jpg http://192.168.1.64/ISAPI/Streaming/channels/101/picture
```
`snap.jpg` harus foto kamera dengan tanggal/jam di pojok. Kalau `401` → username/password
salah atau user belum punya hak Live View.

### 8. Isi di dashboard admin
Pengaturan Perangkat → (device) → kartu **CCTV**:
- IP kamera di LAN lapangan: `192.168.1.64`
- URL streaming (live): `https://cctv-sijagakali.inspiralabs.id/cam-node-001/index.m3u8`
- Snapshot berkala: `15` menit (0 = mati) → **Simpan interval**

Tombol **Ambil snapshot** dan live video baru berhasil setelah Raspberry Pi + sisi VPS
di [02](02-raspberry-pi.md) selesai.

## Kuota 4G (±83 GB/bulan)
- Live ±230 MB/jam, hanya saat ada yang menonton; berhenti otomatis setelah 5 menit.
- Snapshot berkala (sub stream) ±150 MB/bulan; snapshot alarm ±400 KB per kejadian.
