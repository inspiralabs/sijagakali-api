# 04 — Update Firmware ESP32 lewat OTA

OTA (*over the air*) = memasang firmware baru ke ESP32 di lokasi **tanpa kabel USB**.
Alurnya: build `.bin` di laptop → unggah ke dashboard OTA (disimpan di Cloudflare R2) →
klik **Deploy** → server mengirim perintah lewat MQTT → ESP32 mengunduh `.bin`, menulisnya
ke flash, lalu restart ke versi baru.

```
Laptop: pio run → firmware.bin
   │ unggah
   ▼
https://ota-sijagakali.inspiralabs.id ──simpan──► Cloudflare R2 (firmware/<versi>.bin)
   │ Deploy
   ▼
broker MQTT ── sijagakali/<device>/command {"cmd":"ota_update", url} ──► ESP32
ESP32 ── unduh .bin (HTTPS) → tulis flash → ack ke sijagakali/<device>/command/ack → restart
ESP32 (versi baru) ── heartbeat firmware_version ──► dashboard OTA: kolom Firmware berubah
```

> Terkait: device harus sudah di-flash sekali lewat USB dan **online** — lihat
> [03 — ESP32](03-esp32.md). Device ID & password MQTT ikut ter-compile di `.bin` —
> lihat [peta kredensial](README.md#peta-kredensial--nilai-yang-saling-terkait).

## Syarat

| Syarat | Cara cek |
|---|---|
| Device pernah di-flash lewat USB dengan firmware yang mendukung OTA (semua versi `sijagakali-v1.x`) | — |
| Device **online** | Tab **Perangkat** → Status `Online` (heartbeat masuk ≤ 6 menit terakhir) |
| Akun admin dashboard SiJagaKali | Dipakai untuk login dashboard OTA |
| Laptop dengan PlatformIO + repo `sijagakali-firmware` | `pio --version` |

## Aturan penting — baca dulu

1. **Uji di meja lewat USB sebelum OTA ke lapangan.** Rollback otomatis ESP32 hanya
   terjadi kalau firmware baru *crash saat boot*. Kalau firmware baru menyala tapi salah
   WiFi/password MQTT/broker, device **tidak bisa dihubungi lagi** dan harus diambil untuk
   flash ulang lewat USB.
2. **Satu file `.bin` = satu device.** `DEVICE_ID`, `MQTT_USER`, dan `MQTT_PASSWORD`
   di-compile ke dalam `.bin`. Jangan deploy `.bin` milik `node-001` ke `node-002`
   (device kedua akan login sebagai `node-001`). Untuk banyak device, build terpisah dan beri
   versi berbeda, mis. `sijagakali-v1.1.0-node-002`.
3. **`.bin` berisi password WiFi & MQTT device, dan bucket R2 saat ini publik.** Siapa pun
   yang tahu URL `…/firmware/<versi>.bin` bisa mengunduhnya. Pakai nama versi yang tidak
   mudah ditebak bila perlu, dan ganti password device (`mqtt-user.sh del` + `add`) bila
   file bocor.
4. **Versi harus unik dan sama persis** dengan `FIRMWARE_VERSION` di `src/main.cpp`.
   Hanya huruf, angka, `.`, `_`, `-` (mis. `sijagakali-v1.1.0`). Versi yang sudah pernah
   diunggah tidak bisa diunggah ulang — naikkan versinya.
5. Pengaturan yang disimpan device (tinggi sensor hasil kalibrasi, interval baca) **tetap
   tersimpan** setelah OTA.

## Langkah

### 1. Siapkan firmware di laptop
Di `sijagakali-firmware/src/main.cpp` (nilai rahasia **tidak** di-commit):
```cpp
#define WIFI_SSID "..."            // sama dengan yang sedang dipakai device
#define WIFI_PASSWORD "..."
#define MQTT_BROKER_URI "mqtts://mqtt.inspiralabs.id:8883"
#define MQTT_USER "node-001"       // device tujuan
#define MQTT_PASSWORD "..."        // password akun MQTT device tujuan
#define DEVICE_ID "node-001"
#define FIRMWARE_VERSION "sijagakali-v1.1.0"   // NAIKKAN dari versi yang sedang jalan
```
Versi yang sedang jalan terlihat di tab **Perangkat**, kolom **Firmware**.

### 2. Uji di meja (sangat disarankan)
Pakai ESP32 cadangan (atau device yang sama sebelum dipasang) dengan kabel USB:
```bash
pio run -t upload -t monitor
```
Pastikan Serial menampilkan `WiFi connected`, `MQTT: connected`, dan `Published sensor/data`.

### 3. Build file `.bin`
```bash
pio run
```
Hasil: `sijagakali-firmware/.pio/build/esp32-c5-devkitc-1/firmware.bin`
(Windows: `~/.platformio/penv/Scripts/pio.exe run`)

### 4. Unggah ke dashboard OTA
1. Buka https://ota-sijagakali.inspiralabs.id, login dengan akun admin SiJagaKali.
2. Tab **Firmware**:
   - **Versi**: persis `FIRMWARE_VERSION` dari langkah 1 (mis. `sijagakali-v1.1.0`)
   - **Catatan**: ringkas perubahan (mis. "hapus data dummy, broker infra")
   - **File .bin**: pilih `firmware.bin` dari langkah 3
   - klik **Unggah** → muncul di tabel (Versi, Ukuran, Diunggah, Catatan).

### 5. Deploy ke ESP32
1. Tab **Perangkat**: cari device (mis. `node-001`), pastikan Status **Online**.
   Device dengan versi lama ditandai *outdated*.
2. Klik **Deploy** → pilih versi → **Deploy**.
3. Tab **Riwayat**: status **Menunggu** → **Berhasil** atau **Gagal** (kolom **Detail**
   berisi pesan dari device).

### 6. Pastikan versi baru jalan
- Dalam ±1–3 menit device restart, lalu kirim heartbeat.
- Tab **Perangkat**: kolom **Firmware** = versi baru, Status **Online**.
- Dashboard SiJagaKali: data level air masuk lagi.

"Berhasil" di Riwayat berarti file sudah ditulis ke flash dan device akan restart; bukti
akhirnya adalah kolom **Firmware** berubah.

## Kalau gagal

| Gejala | Penyebab umum | Tindakan |
|---|---|---|
| Riwayat tetap **Menunggu** | Device offline / tidak menerima perintah | Cek Status Online; tunggu heartbeat lalu Deploy ulang |
| **Gagal**, detail `update failed: ...` | Unduhan putus (sinyal 4G), file korup | Deploy ulang. Device tetap memakai firmware lama |
| **Berhasil**, tapi device lalu **Offline** terus | Firmware baru salah WiFi/MQTT/broker | Ambil device, flash ulang lewat USB dengan konfigurasi benar |
| Kolom Firmware tidak berubah walau Online | `FIRMWARE_VERSION` di kode ≠ Versi yang diunggah | Samakan, build & unggah versi baru |
| Unggah ditolak | Versi sudah ada / karakter tidak valid | Pakai versi baru dengan huruf, angka, `.`, `_`, `-` |

## Uji OTA gagal-aman (opsional, checklist #9)
Dari VPS, kirim perintah OTA dengan URL yang tidak ada:
```bash
sudo docker compose -f /opt/server-setup/infra/docker-compose.yml exec mosquitto \
  mosquitto_pub -u sijagakali-backend -P 'PW_BACKEND' -t sijagakali/node-001/command \
  -m '{"cmd":"ota_update","request_id":"bad-1","params":{"url":"https://ota-sijagakali.inspiralabs.id/tidak-ada.bin"}}'
```
Device harus membalas ack `ok:false`, tetap di versi lama, dan tetap mengirim data.
