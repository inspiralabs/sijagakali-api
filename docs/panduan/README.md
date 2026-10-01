# Panduan Pemasangan Lapangan SiJagaKali

Tiga perangkat dipasang di lokasi sungai. Semuanya tersambung ke **router 4G TP-Link
TL-MR100** dan dikelola dari **VPS** (`srv2016160`, 72.62.125.210).

| Panduan | Isi |
|---|---|
| [01-cctv.md](01-cctv.md) | Kamera Hikvision DS-2CD1041G2-LIUF: live video + snapshot |
| [02-raspberry-pi.md](02-raspberry-pi.md) | Raspberry Pi 3B+ sebagai "jembatan" Tailscale ke kamera |
| [03-esp32.md](03-esp32.md) | ESP32-C5 + sensor ultrasonik A01ANY4B: level air via MQTT |

## Gambaran

```
LOKASI SUNGAI (LAN router 192.168.1.0/24)
  ESP32-C5 + sensor ──WiFi──┐
  Kamera Hikvision ──LAN/PoE┼── Router TL-MR100 (4G, tanpa IP publik)
  Raspberry Pi 3B+ ──LAN────┘          │ internet
                                       ▼
VPS
  ├─ ESP32 → mqtts://mqtt.inspiralabs.id:8883 (broker MQTT infra) → mqtt-collector → data-processing → WA
  ├─ data-processing/api ──Tailscale (lewat Pi)──► kamera: snapshot JPEG (ISAPI)
  └─ MediaMTX ──Tailscale (lewat Pi)──► kamera: live RTSP → HLS https://cctv-sijagakali.inspiralabs.id
```

- **ESP32 tidak butuh Raspberry Pi.** Ia langsung ke internet lewat WiFi router.
- **Kamera butuh Raspberry Pi.** Server tidak bisa menjangkau kamera di balik 4G (CGNAT) tanpa jembatan Tailscale.

## Urutan pemasangan

1. **Router TL-MR100**: kartu GSM aktif, WiFi menyala, LAN `192.168.1.x` (bawaan pabrik).
2. **Kamera** ([01](01-cctv.md)): IP statis, user khusus, sub stream H.264, OSD + NTP.
3. **Raspberry Pi** ([02](02-raspberry-pi.md)): Tailscale subnet router, lalu sisi VPS (Tailscale + NAT).
4. **Dashboard admin**: isi IP kamera + URL live di Pengaturan Perangkat → CCTV.
5. **ESP32** ([03](03-esp32.md)): bisa kapan saja setelah langkah 1; tidak bergantung pada kamera/Pi.
6. Jalankan uji di [`deploy/e2e-checklist.md`](../../deploy/e2e-checklist.md).

## Peta kredensial & nilai yang saling terkait

Nilai di satu tempat **harus sama persis** dengan tempat lain di baris yang sama.
Jangan menulis nilai rahasia di chat atau commit — simpan di password manager.

| Nilai | Dibuat / ditentukan di | Harus diisi juga di |
|---|---|---|
| **Device ID** (mis. `node-001`) | Dashboard admin → Tambah Perangkat | ESP32 `DEVICE_ID` & `MQTT_USER`; nama akun MQTT; path live `cam-<device_id>` di `deploy/mediamtx.yml` |
| **Akun MQTT device** (`node-001` + password) | VPS: `sudo /opt/server-setup/bin/mqtt-user.sh add <device_id>` (password dicetak sekali) | ESP32 `MQTT_USER` / `MQTT_PASSWORD`. `node-001` **sudah dibuat**; passwordnya tersimpan di VPS `/srv/apps/sijagakali-api/.mqtt-node-001.pass` |
| **Akun MQTT backend** (`sijagakali-backend`) | Sudah ada di broker infra | VPS `.env` sijagakali-api **dan** sijagakali-ota (`MQTT_USERNAME`/`MQTT_PASSWORD`). Jangan dipakai di ESP32 |
| **WiFi router** (SSID + password) | Halaman admin TL-MR100 | ESP32 `WIFI_SSID`/`WIFI_PASSWORD`; Raspberry Pi bila tidak memakai kabel LAN |
| **User kamera** (username + password, hak *Live View*) | Web admin kamera | VPS `.env` sijagakali-api: `CCTV_USERNAME`/`CCTV_PASSWORD` (saat ini username `sijagakali-sukses`) **dan** VPS `deploy/mediamtx.yml` (`rtsp://USER:PASS@IP...`) |
| **IP statis kamera** (saat ini `192.168.1.101`) | Kamera (atau reservasi DHCP router) | Dashboard → CCTV "IP kamera di LAN lapangan"; VPS `deploy/mediamtx.yml` |
| **Subnet LAN** (`192.168.1.0/24`) | Router | Raspberry Pi `tailscale up --advertise-routes=...` |
| **Akun Tailscale** | tailscale.com (gratis) | Raspberry Pi **dan** VPS harus login ke tailnet yang sama |
| **URL live** | Otomatis: `https://cctv-sijagakali.inspiralabs.id/cam-<device_id>/index.m3u8` | Dashboard → CCTV "URL streaming (live)" |

Kalau salah satu nilai kamera berubah (IP, username, password), ubah **semua** tempat
di barisnya, lalu di VPS: `docker compose -p sijagakali-api restart mediamtx data-processing api`.
