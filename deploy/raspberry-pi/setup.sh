#!/bin/bash
# Setup Raspberry Pi SiJagaKali (jembatan Tailscale ke kamera) sampai production ready.
# Aman dijalankan ulang. Panduan lengkap: docs/panduan/02-raspberry-pi.md
#
# Dari laptop (setelah flash Raspberry Pi OS Lite 64-bit + SSH key via Imager):
#   scp -r deploy/raspberry-pi <user>@<ip-pi>:
#   ssh <user>@<ip-pi> 'sudo bash raspberry-pi/setup.sh'
#
# Nilai lokasi (hanya dipakai saat /etc/sijagakali/site.conf belum ada):
#   sudo SITE_NAME=bojongkulur SITE_SUBNET=192.168.1.0/24 CAMERA_IP=192.168.1.101 bash raspberry-pi/setup.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Jalankan dengan sudo"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
HERE=$(cd "$(dirname "$0")" && pwd)
log(){ echo "== $*"; }

log "1. konfigurasi lokasi /etc/sijagakali/site.conf"
install -d -m 755 /etc/sijagakali
[ -f /etc/sijagakali/site.conf ] || cat > /etc/sijagakali/site.conf <<CONF
# Konfigurasi lokasi SiJagaKali. Setelah mengubah, jalankan: sudo sjk-apply
SITE_NAME=${SITE_NAME:-bojongkulur}
# Subnet LAN router di lokasi; Tailscale meneruskan subnet ini ke VPS
SITE_SUBNET=${SITE_SUBNET:-192.168.1.0/24}
# IP kamera Hikvision (dipakai sjk-health)
CAMERA_IP=${CAMERA_IP:-192.168.1.101}
CONF
install -m 755 "$HERE/sjk-apply" "$HERE/sjk-health" /usr/local/bin/

log "2. update sistem + update keamanan otomatis"
apt-get update -qq
apt-get -y -qq -o Dpkg::Options::=--force-confold full-upgrade
apt-get -y -qq install unattended-upgrades
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

log "3. log sistem di RAM"
mkdir -p /etc/systemd/journald.conf.d
printf '[Journal]\nStorage=volatile\nRuntimeMaxUse=30M\n' > /etc/systemd/journald.conf.d/10-sijagakali.conf
systemctl restart systemd-journald

log "4. kurangi tulisan ke microSD (commit=600)"
sed -i -E 's#^(\S+\s+/\s+ext4\s+defaults,noatime)(\s)#\1,commit=600\2#' /etc/fstab
grep -E '\s/\s' /etc/fstab
if systemctl list-unit-files | grep -q '^dphys-swapfile'; then
  dphys-swapfile swapoff || true; systemctl disable --now dphys-swapfile || true   # OS lama: swap di SD
fi

log "5. hardware watchdog (restart otomatis bila macet > 15 detik)"
mkdir -p /etc/systemd/system.conf.d
printf '[Manager]\nRuntimeWatchdogSec=15\nRebootWatchdogSec=2min\n' > /etc/systemd/system.conf.d/10-sijagakali-watchdog.conf

log "6. bluetooth mati (WiFi tetap aktif sebagai cadangan bila kabel LAN lepas)"
grep -q '^dtoverlay=disable-bt' /boot/firmware/config.txt || echo 'dtoverlay=disable-bt' >> /boot/firmware/config.txt
systemctl disable --now hciuart bluetooth 2>/dev/null || true

log "7. tailscale + ip forwarding"
command -v tailscale >/dev/null || curl -fsSL https://tailscale.com/install.sh | sh
printf 'net.ipv4.ip_forward = 1\nnet.ipv6.conf.all.forwarding = 1\n' > /etc/sysctl.d/99-tailscale.conf
sysctl -p /etc/sysctl.d/99-tailscale.conf >/dev/null
systemctl enable --now tailscaled

log "8. SSH hanya dengan key"
KEYS="$(getent passwd "${SUDO_USER:-root}" | cut -d: -f6)/.ssh/authorized_keys"
if [ -s "$KEYS" ]; then
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\n' > /etc/ssh/sshd_config.d/10-sijagakali.conf
  sshd -t && systemctl reload ssh
else
  echo "   DILEWATI: $KEYS kosong — pasang SSH key dulu agar tidak terkunci, lalu jalankan ulang."
fi

log "9. pesan login"
cat > /etc/motd <<'MOTD'

  SiJagaKali Pi - jembatan Tailscale ke kamera
    sjk-health                          cek daya, suhu, disk, tailscale, kamera
    sudo nano /etc/sijagakali/site.conf ubah subnet/IP kamera lokasi
    sudo sjk-apply                      terapkan perubahan site.conf

MOTD

. /etc/sijagakali/site.conf
cat <<NEXT

== selesai. Langkah berikutnya:
  1. sudo tailscale up --hostname=$(hostname) --advertise-routes=$SITE_SUBNET --ssh
     (buka link yang muncul, login akun Tailscale yang sama dengan VPS)
  2. https://login.tailscale.com/admin/machines -> $(hostname):
     Edit route settings (centang $SITE_SUBNET) + Disable key expiry
  3. sudo reboot   (aktifkan watchdog & matikan bluetooth), lalu: sjk-health
  4. Ganti password user: passwd
NEXT
