# Jaringan CCTV: Hikvision → Raspberry Pi (Tailscale) → VPS

Kamera ada di LAN router 4G (CGNAT, tanpa IP publik). Raspberry Pi di LAN yang sama
menjadi **Tailscale subnet router**; VPS ikut tailnet dan bisa menjangkau IP LAN kamera
(snapshot ISAPI + RTSP untuk MediaMTX). Tidak ada port yang dibuka di router lokasi.

## 1. Kamera Hikvision DS-2CD1041G2-LIUF (web admin kamera)

1. **IP statis**: Configuration → Network → Basic Settings → TCP/IP → matikan DHCP,
   isi IP tetap (mis. `192.168.1.64`), gateway = IP router 4G. Atau reservasi DHCP di router.
2. **Sub stream** (dipakai live): Configuration → Video/Audio → Video → Stream Type
   **Sub Stream** → Video Encoding **H.264** (bukan H.265 — browser tidak bisa memutar H.265),
   Resolution 640×360 atau 640×480, Bitrate Type **Constant**, Max Bitrate **512 Kbps**,
   Frame Rate 15.
3. **User khusus**: System → User Management → Add → level **User**, hak **Remote: Live View**
   saja. Username/password ini = `CCTV_USERNAME`/`CCTV_PASSWORD` di `.env` VPS dan di
   `deploy/mediamtx.yml`.
4. **Auth**: System → Security → Authentication → WEB Authentication **digest**
   (default), RTSP Authentication **digest**.
5. Pastikan ISAPI aktif: Network → Advanced → Integration Protocol (bila ada opsi
   "Enable ISAPI"/"Hikvision-CGI", aktifkan).
6. **Timestamp di gambar (OSD)**: Configuration → Image → OSD Settings → centang
   *Display Date* (format 24 jam) dan isi *Camera Name* (mis. "Kali Bojong Kulur").
   Tanggal/jam tercetak di video live **dan** snapshot — tanpa kode.
7. **Jam akurat**: Configuration → System → System Settings → Time Settings →
   **NTP** (`pool.ntp.org`), zona waktu **GMT+07:00**.

Uji dari laptop di WiFi lokasi:
```bash
curl --digest -u USER:PASS -o snap.jpg http://192.168.1.64/ISAPI/Streaming/channels/101/picture
```
`snap.jpg` harus berupa foto kamera.

## 2. Raspberry Pi (lokasi)

Perangkat: **Raspberry Pi 3 Model B+** (cukup — hanya meneruskan jaringan), microSD
**SanDisk High Endurance / Samsung PRO Endurance 32 GB** (kartu biasa cepat rusak di
perangkat 24 jam), adaptor **5V ≥2.5A micro-USB** (adaptor lemah → undervoltage → SD
korup), kabel LAN ke port TL-MR100, casing berventilasi.

OS: **Raspberry Pi OS Lite (64-bit)** via Raspberry Pi Imager (aktifkan SSH di
pengaturan Imager).

```bash
curl -fsSL https://tailscale.com/install.sh | sh
echo 'net.ipv4.ip_forward = 1' | sudo tee /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
sudo tailscale up --advertise-routes=192.168.1.0/24 --hostname=sijagakali-pi-node-001 --ssh

# Kurangi tulisan ke SD: log di RAM
sudo sed -i 's/^#\?Storage=.*/Storage=volatile/' /etc/systemd/journald.conf
sudo systemctl restart systemd-journald
# Update keamanan otomatis
sudo apt-get install -y unattended-upgrades
```

`--ssh` = Tailscale SSH: Pi bisa dikelola dari laptop/VPS mana pun di tailnet tanpa
membuka port di router.

Sesuaikan `192.168.1.0/24` dengan subnet LAN router 4G. Lalu di
https://login.tailscale.com/admin/machines:
- Pi → **Edit route settings** → setujui `192.168.1.0/24`.
- Pi dan VPS → **Disable key expiry** (agar tidak putus tiap 180 hari).

## 3. VPS (host, bukan container)

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --accept-routes --hostname=sijagakali-vps
ping -c 3 192.168.1.64
curl --digest -u USER:PASS -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  http://192.168.1.64/ISAPI/Streaming/channels/101/picture   # harus: 200 image/jpeg
```

Container docker belum tentu bisa lewat tailnet (sumber paket = IP bridge docker).
Tambahkan NAT untuk subnet network `edge`:

```bash
EDGE_SUBNET=$(docker network inspect edge -f '{{(index .IPAM.Config 0).Subnet}}')
sudo iptables -t nat -A POSTROUTING -s "$EDGE_SUBNET" -o tailscale0 -j MASQUERADE
sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save
```

**Verifikasi wajib** (dari dalam container di network `edge`):
```bash
docker run --rm --network edge curlimages/curl --digest -u USER:PASS -s -o /dev/null \
  -w '%{http_code} %{content_type}\n' http://192.168.1.64/ISAPI/Streaming/channels/101/picture
```
Harus `200 image/jpeg`. Bila timeout: cek `ip route show table 52 | grep 192.168.1`
(route tailnet ada?), `sudo iptables -t nat -S POSTROUTING` (aturan MASQUERADE ada?).

## 4. Isi data device (dashboard admin → Pengaturan Perangkat → CCTV)

- IP kamera di LAN lapangan: `192.168.1.64`
- URL streaming: `https://cctv-sijagakali.inspiralabs.id/cam-node-001/index.m3u8`

## Kuota

Live ±230 MB/jam (512 kbps). Tanpa penonton: 0. Snapshot ±400 KB per notifikasi.
Player dashboard berhenti otomatis setelah 5 menit.
