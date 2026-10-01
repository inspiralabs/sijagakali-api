# 02 — Setup Raspberry Pi (jembatan Tailscale ke kamera)

Internet lokasi memakai 4G (CGNAT, tanpa IP publik), jadi VPS tidak bisa langsung
menghubungi kamera. Raspberry Pi di LAN yang sama menjadi **Tailscale subnet router**:
Pi membuka koneksi terenkripsi keluar ke tailnet, sehingga VPS bisa menjangkau
`192.168.1.101` (snapshot + live) tanpa membuka port apa pun di router.

Pi **hanya** untuk kamera. ESP32 tidak membutuhkannya.

> Terkait: subnet yang di-advertise harus subnet LAN router; IP kamera dari
> [01 — CCTV](01-cctv.md); akun Tailscale yang sama dipakai di VPS (langkah B).

## Kebutuhan

| Barang | Catatan |
|---|---|
| Raspberry Pi 3 Model B+ | Sudah ada — cukup (hanya meneruskan jaringan) |
| microSD **SanDisk High Endurance 32 GB** | Untuk Pi (OS), bukan kamera. Cek keaslian dengan **H2testw** (harus "without errors", ±29 GB) |
| Adaptor **5V ≥2.5A micro-USB** | Adaptor lemah → undervoltage → SD korup |
| Kabel LAN ke port router | Lebih stabil dari WiFi |
| Casing berventilasi | Lokasi panas |
| Akun **Tailscale** (gratis) | https://login.tailscale.com — dipakai Pi **dan** VPS |
| *(opsional)* Mini UPS | Listrik sering padam |

## A. Raspberry Pi (di lokasi)

### 1. Flash OS
1. Install **Raspberry Pi Imager** di laptop.
2. Device: Raspberry Pi 3 · OS: **Raspberry Pi OS Lite (64-bit)** · Storage: microSD.
3. Pengaturan (ikon ⚙ / "Edit settings"): hostname `sijagakali-pi-node-001`, buat
   user + password, **Enable SSH**. Isi WiFi hanya bila tidak memakai kabel LAN.
4. Tulis, pasang microSD ke Pi, colok LAN + listrik.

### 2. Masuk ke Pi
Dari laptop di WiFi router: `ssh <user>@sijagakali-pi-node-001.local`
(atau pakai IP Pi dari daftar DHCP router).

### 3. Pasang Tailscale sebagai subnet router
```bash
curl -fsSL https://tailscale.com/install.sh | sh
echo 'net.ipv4.ip_forward = 1' | sudo tee /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
sudo tailscale up --advertise-routes=192.168.1.0/24 --hostname=sijagakali-pi-node-001 --ssh
```
Buka link login yang muncul, masuk dengan akun Tailscale Anda.

`192.168.1.0/24` = subnet LAN TL-MR100. Kalau router Anda memakai subnet lain, sesuaikan.

### 4. Setujui route & matikan kedaluwarsa kunci
Di https://login.tailscale.com/admin/machines:
- Pi → **⋯ → Edit route settings** → centang `192.168.1.0/24` → Save.
- Pi → **⋯ → Disable key expiry** (kalau tidak, putus tiap 180 hari).

### 5. Supaya awet 24 jam
```bash
# log di RAM (kurangi tulisan ke microSD)
sudo sed -i 's/^#\?Storage=.*/Storage=volatile/' /etc/systemd/journald.conf
sudo systemctl restart systemd-journald
# update keamanan otomatis
sudo apt-get install -y unattended-upgrades
```

### 6. Uji dari Pi
```bash
curl --digest -u sijagakali-sukses:PASSWORD -s -o /dev/null -w '%{http_code} %{content_type}\n' \
  http://192.168.1.101/ISAPI/Streaming/channels/101/picture
```
Harus `200 image/jpeg`.

## B. VPS (sekali saja — butuh sudo)

Dikerjakan admin VPS (SSH `inspiralabs@72.62.125.210`).

```bash
# 1. Tailscale di host VPS, login ke tailnet yang SAMA dengan Pi
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --accept-routes --hostname=sijagakali-vps
```
Di admin Tailscale: VPS → **Disable key expiry**.

```bash
# 2. Uji dari host VPS
ping -c 3 192.168.1.101

# 3. Container Docker (network edge) harus bisa lewat tailnet → NAT
EDGE_SUBNET=$(docker network inspect edge -f '{{(index .IPAM.Config 0).Subnet}}')
sudo iptables -t nat -A POSTROUTING -s "$EDGE_SUBNET" -o tailscale0 -j MASQUERADE
sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save

# 4. VERIFIKASI WAJIB dari dalam container
docker run --rm --network edge curlimages/curl --digest -u sijagakali-sukses:PASSWORD -s -o /dev/null \
  -w '%{http_code} %{content_type}\n' http://192.168.1.101/ISAPI/Streaming/channels/101/picture
```
Harus `200 image/jpeg`. Bila timeout: `ip route show table 52 | grep 192.168.1` (route
tailnet ada?) dan `sudo iptables -t nat -S POSTROUTING` (aturan MASQUERADE ada?).

## C. Uji akhir
- Dashboard → Pengaturan Perangkat → CCTV → **Ambil snapshot** → foto muncul.
- Dashboard publik → Pantau CCTV → **Live** → **Putar live** → video main ≤10 detik.

## Perawatan
- Pi bisa dikelola dari mana saja: `ssh <user>@sijagakali-pi-node-001` lewat Tailscale
  (`--ssh` sudah aktif) — tanpa ke lokasi.
- Kalau Pi mati, notifikasi level air tetap jalan; hanya foto/live yang tidak tersedia
  (WA terkirim teks saja).
