# 02 — Setup Raspberry Pi (jembatan Tailscale ke kamera) — sampai production ready

Internet lokasi memakai 4G (CGNAT, tanpa IP publik), jadi VPS tidak bisa langsung
menghubungi kamera. Raspberry Pi di LAN yang sama menjadi **Tailscale subnet router**:
Pi membuka koneksi terenkripsi keluar ke tailnet, sehingga VPS bisa menjangkau
`192.168.1.64` (snapshot + live) tanpa membuka port apa pun di router.

Pi **hanya** untuk kamera. ESP32 tidak membutuhkannya. Kalau Pi mati, notifikasi level
air tetap jalan; hanya foto/live yang tidak tersedia (WA terkirim teks saja).

> Terkait: subnet yang di-advertise = subnet LAN router; IP kamera dari
> [01 — CCTV](01-cctv.md); akun Tailscale yang sama dipakai di VPS (bagian B).

"Production ready" di sini berarti: menyala sendiri setelah listrik padam, pulih sendiri
kalau hang, aman dari login sembarangan, hemat tulisan ke microSD, update keamanan
otomatis, bisa dikelola dari jauh, dan bisa diganti cepat kalau microSD rusak.

## Kebutuhan

| Barang | Catatan |
|---|---|
| Raspberry Pi 3 Model B+ | Sudah ada — cukup (hanya meneruskan jaringan, CPU nyaris idle) |
| microSD **SanDisk High Endurance 32 GB** | Untuk Pi (OS), bukan kamera. Cek keaslian dengan **H2testw** (harus "without errors", ±29 GB) |
| Card reader | Untuk menulis OS dari laptop |
| Adaptor **5V ≥2.5A micro-USB** (sebaiknya resmi Raspberry Pi) | Adaptor lemah → undervoltage → SD korup |
| Kabel LAN ke port router TL-MR100 | Lebih stabil dari WiFi |
| Casing berventilasi (+ heatsink) | Lokasi panas |
| Akun **Tailscale** (gratis) | https://login.tailscale.com — dipakai Pi **dan** VPS |
| *(opsional)* Mini UPS DC untuk router + Pi | Listrik desa sering padam |

Nilai yang dipakai di panduan ini (ganti bila berbeda):

| Nilai | Contoh |
|---|---|
| Hostname Pi | `sijagakali-pi-node-001` |
| Username Pi | `sjk` (bebas, **bukan** `pi`/`admin`) |
| Subnet LAN router | `192.168.1.0/24`, gateway `192.168.1.1` |
| IP tetap Pi | `192.168.1.10` |
| IP kamera | `192.168.1.64` |

---

## Cara cepat (disarankan): skrip setup

Langkah 4–11 di bawah sudah dibungkus dalam skrip `deploy/raspberry-pi/setup.sh`
(aman dijalankan ulang). Untuk pemasangan baru — termasuk pindah ke microSD baru —
**flash ulang lalu jalankan skrip**, bukan menyalin image kartu uji.

1. Langkah 1–3 di bawah: SSH key, flash Raspberry Pi OS Lite (64-bit) dengan SSH
   public key, boot & cari IP.
2. Dari laptop, di folder repo `sijagakali-api`:
   ```bash
   scp -r deploy/raspberry-pi <user>@<ip-pi>:
   ssh <user>@<ip-pi> 'sudo bash raspberry-pi/setup.sh'
   ```
   Lokasi lain? Isi nilainya: `sudo SITE_NAME=... SITE_SUBNET=192.168.x.0/24 CAMERA_IP=... bash raspberry-pi/setup.sh`
3. Ikuti 4 langkah yang dicetak di akhir skrip: `tailscale up` (login), setujui route +
   matikan key expiry, `sudo reboot`, ganti password (`passwd`).
4. `sjk-health` → semua baris OK (Kamera baru terjangkau setelah Pi di LAN lokasi).
5. Langkah 12: backup image kartu yang sudah jadi.

Hasil skrip:

| Yang dipasang | Lokasi file |
|---|---|
| Nilai per lokasi (subnet, IP kamera) | `/etc/sijagakali/site.conf` → ubah lalu `sudo sjk-apply` |
| Cek kondisi | `sjk-health` (daya, suhu, disk, Tailscale, kamera) |
| Log di RAM | `/etc/systemd/journald.conf.d/10-sijagakali.conf` |
| Watchdog | bawaan Raspberry Pi OS (`40-rpi-enable-watchdog.conf`); `50-sijagakali-watchdog.conf` hanya di OS lama |
| SSH hanya key (dilewati bila belum ada key) | `/etc/ssh/sshd_config.d/10-sijagakali.conf` |
| Update keamanan otomatis | `/etc/apt/apt.conf.d/20auto-upgrades` |
| IP forwarding Tailscale | `/etc/sysctl.d/99-tailscale.conf` |

Pengaturan disimpan sebagai file terpisah — untuk membatalkan salah satu, cukup hapus filenya.
Bagian A di bawah adalah penjelasan manual dari apa yang dilakukan skrip.

---

## A. Raspberry Pi (dikerjakan sebelum dibawa ke lokasi)

Kerjakan langkah 1–9 di rumah/kantor dengan Pi tersambung ke router mana pun.
Langkah 10 (uji ke kamera) dan route Tailscale berfungsi penuh setelah Pi berada di
LAN yang sama dengan kamera.

### 1. Siapkan SSH key di laptop (sekali saja)
Login ke Pi nanti memakai key, bukan password.
```bash
# Windows PowerShell / Git Bash / macOS / Linux
ssh-keygen -t ed25519 -C "laptop-sijagakali"     # Enter saja kalau sudah punya ~/.ssh/id_ed25519
cat ~/.ssh/id_ed25519.pub                        # isi ini dipakai di langkah 2
```

### 2. Flash Raspberry Pi OS Lite (64-bit)
1. Unduh & install **Raspberry Pi Imager**: https://www.raspberrypi.com/software/
2. Masukkan microSD ke card reader.
3. Di Imager pilih:
   - **Device**: Raspberry Pi 3
   - **Operating System**: *Raspberry Pi OS (other)* → **Raspberry Pi OS Lite (64-bit)**
     (tanpa desktop — lebih ringan, lebih sedikit yang bisa rusak)
   - **Storage**: microSD Anda (pastikan drive yang benar — isinya dihapus)
4. **Next → Edit Settings** (OS customisation):
   - **General**: hostname `sijagakali-pi-node-001`; username `sjk` + password kuat
     (simpan di password manager); **Wireless LAN dikosongkan** (pakai kabel); locale
     **Asia/Jakarta**, keyboard `us`.
   - **Services**: centang **Enable SSH** → **Allow public-key authentication only** →
     tempel isi `id_ed25519.pub` dari langkah 1.
5. **Save → Yes → Yes**. Tunggu *write* dan *verify* selesai, cabut microSD dengan aman.

### 3. Boot pertama & login
1. Pasang microSD, sambungkan **kabel LAN** ke router, lalu colok adaptor 5V 2.5A.
2. Tunggu 1–2 menit. LED merah menyala tetap = daya OK; LED hijau berkedip = membaca SD.
3. Cari IP Pi: halaman admin router (daftar DHCP), atau `ping sijagakali-pi-node-001.local`.
4. Login:
   ```bash
   ssh sjk@sijagakali-pi-node-001.local     # atau ssh sjk@<IP-dari-router>
   ```

### 4. Update sistem
```bash
sudo apt update && sudo apt full-upgrade -y
sudo reboot
```

### 5. IP tetap
Cara terbaik: **reservasi DHCP di router** (TL-MR100 → Advanced → Network → DHCP Server →
Address Reservation: MAC Pi → `192.168.1.10`). Pi tetap DHCP, tapi selalu dapat IP sama.

Kalau router tidak bisa, set statis di Pi (Raspberry Pi OS terbaru memakai NetworkManager):
```bash
nmcli -t -f NAME,DEVICE con show                 # cari nama koneksi eth0, mis. "Wired connection 1"
sudo nmcli con mod "Wired connection 1" ipv4.method manual \
  ipv4.addresses 192.168.1.10/24 ipv4.gateway 192.168.1.1 ipv4.dns "1.1.1.1 8.8.8.8"
sudo nmcli con up "Wired connection 1"
```
Login ulang ke `ssh sjk@192.168.1.10`.

### 6. Keamanan dasar
```bash
# Pastikan login password via SSH mati (Imager "public-key only" sudah mengaturnya)
sudo sshd -T | grep -E '^(passwordauthentication|permitrootlogin)'
# harus: passwordauthentication no   permitrootlogin no (atau without-password)

# Update keamanan otomatis
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades      # pilih Yes
```
Pi tidak menerima koneksi masuk dari internet (di balik CGNAT router 4G), dan akses
jarak jauh lewat Tailscale yang terenkripsi. Firewall `ufw` **tidak** dipasang: aturan
FORWARD-nya bisa memblokir subnet routing Tailscale.

### 7. Matikan yang tidak dipakai (hemat daya & lebih sedikit gangguan)
```bash
# WiFi & Bluetooth tidak dipakai (Pi memakai kabel LAN)
echo -e "dtoverlay=disable-wifi\ndtoverlay=disable-bt" | sudo tee -a /boot/firmware/config.txt
sudo systemctl disable --now hciuart 2>/dev/null || true
```
> Lewati langkah ini kalau Pi terpaksa memakai WiFi.

### 8. Awet untuk 24 jam (kurangi tulisan ke microSD)
```bash
# Log sistem di RAM (hilang saat reboot — cukup untuk perangkat jembatan)
sudo sed -i 's/^#\?Storage=.*/Storage=volatile/' /etc/systemd/journald.conf
sudo sed -i 's/^#\?RuntimeMaxUse=.*/RuntimeMaxUse=30M/' /etc/systemd/journald.conf
sudo systemctl restart systemd-journald

# Matikan swap ke microSD (bila ada dphys-swapfile)
if systemctl list-unit-files | grep -q dphys-swapfile; then
  sudo dphys-swapfile swapoff && sudo systemctl disable --now dphys-swapfile
fi

# Kurangi tulisan metadata file
sudo sed -i 's/\(\s\/\s\+ext4\s\+\)defaults,noatime/\1defaults,noatime,commit=600/' /etc/fstab
grep ' / ' /etc/fstab        # baris root harus berisi noatime,commit=600
```

### 9. Pulih sendiri kalau hang (hardware watchdog)
Raspberry Pi OS terbaru **sudah mengaktifkannya** (`/usr/lib/systemd/system.conf.d/40-rpi-enable-watchdog.conf`). Cek:
```bash
systemctl show -p RuntimeWatchdogUSec      # harus bukan 0, mis. RuntimeWatchdogUSec=1min
```
Kalau `0` (OS lama), tambahkan:
```bash
sudo mkdir -p /etc/systemd/system.conf.d
printf '[Manager]\nRuntimeWatchdogSec=1min\nRebootWatchdogSec=2min\n' | sudo tee /etc/systemd/system.conf.d/50-sijagakali-watchdog.conf
sudo reboot
```
Kalau sistem macet, chip watchdog me-restart Pi otomatis. Setelah listrik padam, Pi
menyala sendiri saat listrik kembali (tidak ada tombol power).

### 10. Pasang Tailscale sebagai subnet router
```bash
curl -fsSL https://tailscale.com/install.sh | sh
echo -e 'net.ipv4.ip_forward = 1\nnet.ipv6.conf.all.forwarding = 1' | sudo tee /etc/sysctl.d/99-tailscale.conf
sudo sysctl -p /etc/sysctl.d/99-tailscale.conf
sudo tailscale up --advertise-routes=192.168.1.0/24 --hostname=sijagakali-pi-node-001 --ssh
```
Buka link login yang muncul, masuk dengan akun Tailscale. Tailscale otomatis jalan setiap
boot (`systemctl is-enabled tailscaled` → `enabled`).

Lalu di https://login.tailscale.com/admin/machines:
- Pi → **⋯ → Edit route settings** → centang `192.168.1.0/24` → **Save**.
- Pi → **⋯ → Disable key expiry** (kalau tidak, putus tiap 180 hari).

### 11. Pemeriksaan kesehatan
```bash
vcgencmd get_throttled        # harus throttled=0x0 (bukan 0x50005 = undervoltage!)
vcgencmd measure_temp         # idealnya < 70'C
tailscale status              # Pi online di tailnet
df -h /                       # sisa ruang microSD
```
Kalau `get_throttled` bukan `0x0`: ganti adaptor/kabel micro-USB sebelum dibawa ke lokasi.

### 11b. Kirim suhu Pi ke dashboard
Suhu CPU Pi dikirim tiap 2 menit lewat MQTT dan tampil di kartu perangkat (memakai akun MQTT
device yang sama dengan ESP32 lokasi ini). `setup.sh` sudah memasang timer-nya; tinggal isi kredensial:
```bash
sudo install -m 600 /dev/null /etc/sijagakali/mqtt.conf
sudo nano /etc/sijagakali/mqtt.conf
#   MQTT_DEVICE_ID=node-001
#   MQTT_PASSWORD=<password akun MQTT node-001>
sudo sjk-report && sjk-health      # baris "Lapor MQTT" harus OK
```
Dashboard menampilkan `—` bila laporan terakhir lebih dari 10 menit (Pi mati / tanpa internet).

### 12. Backup image microSD (cadangan siap pakai)
Setelah semua beres: matikan Pi (`sudo poweroff`), cabut microSD, lalu buat image:
- Windows: **Win32 Disk Imager** → *Read* → simpan `sijagakali-pi-node-001.img`.
- Linux/macOS: `sudo dd if=/dev/sdX of=sijagakali-pi-node-001.img bs=4M status=progress`.

Kalau microSD rusak: tulis image ke microSD baru, pasang → Pi kembali seperti semula
(identitas Tailscale ikut, tidak perlu login ulang).

---

## Di lokasi

1. Colok Pi ke port LAN TL-MR100 (port lain dipakai kamera via PoE injector), lalu daya.
2. Masuk ke Pi — dari laptop di WiFi router (`ssh sjk@192.168.1.10`), atau dari mana pun
   kalau laptop juga memasang Tailscale dan login ke tailnet yang sama:
   ```bash
   ssh sjk@sijagakali-pi-node-001        # lewat Tailscale (Tailscale SSH)
   curl --digest -u sijagakali:PASSWORD -s -o /dev/null -w '%{http_code} %{content_type}\n' \
     http://192.168.1.64/ISAPI/Streaming/channels/101/picture
   ```
   Harus `200 image/jpeg` (user/password kamera: [01 — CCTV](01-cctv.md) langkah 4).

---

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
ping -c 3 192.168.1.64

# 3. Container Docker (network edge) harus bisa lewat tailnet → NAT
EDGE_SUBNET=$(docker network inspect edge -f '{{(index .IPAM.Config 0).Subnet}}')
sudo iptables -t nat -A POSTROUTING -s "$EDGE_SUBNET" -o tailscale0 -j MASQUERADE
sudo apt-get install -y iptables-persistent && sudo netfilter-persistent save

# 4. VERIFIKASI WAJIB dari dalam container
docker run --rm --network edge curlimages/curl --digest -u sijagakali:PASSWORD -s -o /dev/null \
  -w '%{http_code} %{content_type}\n' http://192.168.1.64/ISAPI/Streaming/channels/101/picture
```
Harus `200 image/jpeg`. Bila timeout: `ip route show table 52 | grep 192.168.1` (route
tailnet ada?) dan `sudo iptables -t nat -S POSTROUTING` (aturan MASQUERADE ada?).

## C. Uji akhir
- Dashboard → Pengaturan Perangkat → CCTV → **Ambil snapshot** → foto muncul.
- Dashboard publik → Pantau CCTV → **Live** → **Putar live** → video main ≤10 detik.

## Checklist production ready

- [ ] microSD lolos H2testw; adaptor resmi; `vcgencmd get_throttled` = `0x0`
- [ ] Login SSH hanya dengan key; user default bukan `pi`
- [ ] IP tetap `192.168.1.10` (reservasi DHCP atau statis)
- [ ] `unattended-upgrades` aktif
- [ ] WiFi/Bluetooth dimatikan (bila pakai kabel)
- [ ] Journald di RAM, swap mati, root `noatime,commit=600`
- [ ] Watchdog aktif (`systemctl show -p RuntimeWatchdogUSec` bukan 0)
- [ ] Tailscale: route `192.168.1.0/24` disetujui, key expiry dimatikan (Pi & VPS)
- [ ] VPS: NAT MASQUERADE tersimpan, uji dari container `200 image/jpeg`
- [ ] Image microSD cadangan tersimpan
- [ ] Snapshot & live berhasil dari dashboard

## Perawatan
- Masuk dari mana saja: `ssh sjk@sijagakali-pi-node-001` lewat Tailscale (`--ssh` aktif).
- Cek bulanan: `vcgencmd get_throttled`, `df -h /`, `tailscale status`.
- Update Tailscale ikut `unattended-upgrades`/`apt upgrade` (repo Tailscale terpasang
  oleh skrip install).
