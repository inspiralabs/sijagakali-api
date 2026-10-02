# 00 — Arsitektur Operasional SiJagaKali

Pegangan saat memasang, mengubah, atau mencari masalah: **apa jalan di mana, lewat jalur apa,
pakai alamat apa.** Alur data level kode (topik MQTT, file, sequence lengkap) ada di
`architecture-overview/ALUR-SISTEM.md` (repo terpisah di folder proyek).

## 1. Peta besar

```
┌──────────────── LOKASI SUNGAI ─────────────────┐        ┌─────────────────────── VPS srv2016160 (72.62.125.210) ───────────────────────┐
│ Router 4G TP-Link TL-MR100  (CGNAT, LAN        │        │  Traefik (HTTPS *.inspiralabs.id)      mosquitto infra (8883 TLS publik,     │
│ 192.168.1.0/24, gateway 192.168.1.1)           │        │                                        1883 internal alias "mosquitto")      │
│                                                │        │                                                                              │
│  ESP32-C5 + sensor ──WiFi──────────────────────┼─mqtts──┼─► mosquitto ─► mqtt-collector ─► Supabase ─► data-processing ─► gateway ─► WA │
│                                                │  8883  │                                                     │                         │
│  Kamera Hikvision 192.168.1.101 ──LAN/PoE      │        │   api (REST admin) ◄── dashboard (Vercel)          │ snapshot                │
│        ▲                                       │        │   MediaMTX (HLS)  ◄── browser warga                 │                         │
│        │ LAN                                   │        │        │ RTSP on-demand        ┌────────────────────┘                         │
│  Raspberry Pi (Tailscale subnet router) ◄══════╪═WireGuard (Tailscale, tanpa port terbuka)═╪═ tailscale0 + NAT network "edge"            │
│                                                │        │   ota-api / ota-web ─► R2 (firmware) ; ─► mosquitto ─► ESP32 (OTA)           │
└────────────────────────────────────────────────┘        └──────────────────────────────────────────────────────────────────────────────┘
```

Dua jalur dari lokasi ke VPS, **saling lepas**:

| Jalur | Dipakai oleh | Lewat | Butuh Pi? |
|---|---|---|---|
| MQTT over TLS | ESP32 (data, heartbeat, perintah, OTA) | Internet → `mqtt.inspiralabs.id:8883` | Tidak |
| Tailscale (WireGuard) | Snapshot & live kamera | Pi ⇄ VPS, langsung atau relay DERP Singapura | **Ya** |

Pi mati → level air & WA tetap jalan, hanya foto/live hilang (WA terkirim teks).
ESP32 mati → WA "⚠️ Sensor gangguan/offline" dari server.

## 2. Komponen & alamat

### Di VPS
| Komponen | Container / layanan | Alamat |
|---|---|---|
| API admin (REST) | `sijagakali-api-api-1` | `https://api-sijagakali.inspiralabs.id` (port 3100 internal) |
| Ingest MQTT | `sijagakali-api-mqtt-collector-1` | → `mqtt://mosquitto:1883` |
| Olah data, snapshot, cek kesehatan sensor | `sijagakali-api-data-processing-1` | — |
| WhatsApp | `sijagakali-api-notification-gateway-1` | `http://notification-gateway:3101` (internal) |
| Live CCTV | `sijagakali-api-mediamtx-1` | `https://cctv-sijagakali.inspiralabs.id/cam-<device_id>/index.m3u8` |
| OTA | `sijagakali-ota-ota-api-1`, `-ota-web-1` | `https://ota-sijagakali.inspiralabs.id` |
| Broker MQTT (bersama, milik infra) | `infra-mosquitto-1` | publik `mqtts://mqtt.inspiralabs.id:8883`; internal `mqtt://mosquitto:1883` |
| Tailscale | service host `tailscaled` | `sijagakali-vps` / `100.87.9.39` |
| NAT container → Tailscale | service `sijagakali-tailscale-nat` | MASQUERADE `172.18.0.0/16` (edge) → `tailscale0` |
| Kode & konfigurasi | `/srv/apps/sijagakali-api`, `/srv/apps/sijagakali-ota` (user `deploy`) | auto-deploy saat push ke `master` |

### Di luar VPS
| Komponen | Alamat |
|---|---|
| Dashboard | `https://sijagakali.inspiralabs.id` (Vercel) |
| Database, Realtime, Storage `cctv-images`, Auth | Supabase |
| File firmware | Cloudflare R2 (publik) |
| Tailnet | `inspiralabs9@gmail.com` — mesin `sijagakali-pi-001`, `sijagakali-vps` |
| DNS | Cloudflare wildcard `*.inspiralabs.id` → VPS (proxied); `mqtt.inspiralabs.id` langsung (tidak proxied) |

### Di lokasi
| Perangkat | Alamat | Catatan |
|---|---|---|
| Router TL-MR100 | `192.168.1.1` | LAN `192.168.1.0/24` |
| Raspberry Pi | DHCP (sebaiknya reservasi), Tailscale `100.82.135.110` | `/etc/sijagakali/site.conf`, `sjk-health` |
| Kamera Hikvision | `192.168.1.101` statis | ISAPI port 80, RTSP 554 |
| ESP32 | DHCP | Device ID `node-001` |

## 3. Jalur VPS → kamera (snapshot & live), langkah demi langkah

```
container (172.18.x.x)  ──minta 192.168.1.101──►
  1. VPS: route table 52   192.168.1.0/24 dev tailscale0      (dari Pi, disetujui di admin Tailscale)
  2. VPS: NAT              src 172.18.x.x → 100.87.9.39        (service sijagakali-tailscale-nat)
  3. Tailscale             bungkus WireGuard → Pi              (langsung UDP, atau relay DERP Singapura)
  4. Pi: tailscale0 → ip_forward → eth0  (Pi juga NAT: kamera melihat IP LAN Pi sebagai pengirim)
  5. Kamera                balas ke Pi → kembali lewat jalur yang sama
```

### Snapshot
| Pemicu | Jalan di | Channel kamera | Ukuran |
|---|---|---|---|
| Alarm (status naik, lonjakan, digest) | data-processing | 101 (4MP) | ±300–500 KB |
| Berkala `snapshot_interval_min` (default 15) | data-processing | 102 (sub) | ±50 KB |
| Tombol "Ambil snapshot" admin | api | 101 | ±300–500 KB |

`GET http://192.168.1.101/ISAPI/Streaming/channels/<ch>/picture` (digest, user `CCTV_USERNAME`,
batas 8 detik) → Storage `cctv-images/<slug>/<device>/<tanggal>/<ts>_<device>.jpg` →
`device_configs.last_snapshot_path` (dashboard update realtime) → (alarm) WA foto + teks.

### Live
Browser → `cctv-sijagakali` → MediaMTX; belum ada sesi → buka
`rtsp://USER:PASS@192.168.1.101:554/Streaming/Channels/102` lewat jalur di atas → HLS ke semua
penonton (satu tarikan dari lokasi). Tanpa penonton ±10 detik → RTSP ditutup. Player berhenti
otomatis setelah 5 menit.

## 4. Port & arah koneksi

| Dari → ke | Port | Keterangan |
|---|---|---|
| ESP32 → `mqtt.inspiralabs.id` | 8883/TCP (TLS) | keluar dari lokasi; tidak perlu port masuk |
| ESP32 → Cloudflare R2 | 443 | unduh firmware OTA |
| Pi ⇄ VPS (Tailscale) | 41641/UDP atau 443 (DERP) | keduanya koneksi keluar; router lokasi tidak dibuka |
| VPS (lewat Pi) → kamera | 80 (ISAPI), 554 (RTSP) | hanya di dalam terowongan |
| Browser → VPS | 443 | lewat Cloudflare → Traefik |
| Layanan VPS → mosquitto | 1883 | hanya di network docker `edge` |

**Tidak ada port yang dibuka di router lokasi.** Kamera tidak pernah terlihat dari internet.

## 5. Di mana mengubah apa

| Ingin mengubah | Tempat |
|---|---|
| IP kamera / URL live / interval snapshot | Dashboard → Pengaturan Perangkat → CCTV |
| User/password kamera | Kamera **dan** VPS `.env` (`CCTV_*`) **dan** VPS `deploy/mediamtx.yml` |
| Subnet LAN lokasi | Pi `/etc/sijagakali/site.conf` → `sudo sjk-apply` → setujui di admin Tailscale |
| Ambang, interval baca sensor | Dashboard → Pengaturan Perangkat |
| Akun MQTT device | VPS `sudo /opt/server-setup/bin/mqtt-user.sh add/del <device_id>` + firmware |
| Firmware | [04 — OTA](04-ota.md) |
| Template & kontak WA | Dashboard admin → pengaturan notifikasi WA (template & kontak) |

Daftar lengkap nilai yang harus sama di beberapa tempat: [README — peta kredensial](README.md#peta-kredensial--nilai-yang-saling-terkait).

## 6. Mencari masalah per lapis

| Gejala | Cek (dari mana) | Perintah |
|---|---|---|
| Level air tidak masuk | Serial ESP32 | `MQTT: connected`? `Sensor gagal`? |
| | VPS | `sudo -u deploy docker logs --tail=50 sijagakali-api-mqtt-collector-1` |
| WA tidak terkirim | VPS | `sudo -u deploy docker logs --tail=50 sijagakali-api-notification-gateway-1` |
| Snapshot/live gagal | Pi | `sjk-health` (Tailscale online? route disetujui? kamera terjangkau?) |
| | VPS host | `tailscale status`; `ip route show table 52 \| grep 192.168.1`; `systemctl is-active sijagakali-tailscale-nat` |
| | VPS container | `sudo docker run --rm --network edge curlimages/curl --digest -u USER:PASS -s -o /dev/null -w '%{http_code}\n' http://192.168.1.101/ISAPI/Streaming/channels/101/picture` → `200` |
| | VPS | `sudo -u deploy docker logs --tail=30 sijagakali-api-mediamtx-1` |
| OTA tidak jalan | Dashboard OTA | Device **Online**? Riwayat: Menunggu/Gagal + detail |
| Pi tidak bisa diakses | Admin Tailscale | `sijagakali-pi-001` Connected? Daya cukup (`vcgencmd get_throttled` = `0x0`)? |
