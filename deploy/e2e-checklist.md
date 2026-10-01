# Checklist uji end-to-end SiJagaKali (VPS)

Isi kolom "Hasil" saat menjalankan. Semua harus ✅ sebelum dianggap selesai.

## Prasyarat sebelum uji

- Migrasi Supabase `supabase/migrations/20261001120000_device_configs_snapshot.sql` sudah dijalankan (SQL Editor) di project produksi — menambah kolom `snapshot_interval_min`, `last_snapshot_path`, `last_snapshot_at` dan memasukkan `device_configs` ke Realtime.
- Langkah deploy di bawah (DNS, broker, jaringan CCTV, deploy) sudah selesai — lihat `docs/superpowers/plans/2026-10-01-cctv-mqtt-ota.md` Task 10.

| # | Uji | Perintah / langkah | Lulus bila | Hasil |
|---|---|---|---|---|
| 1 | Dummy → broker → DB | Di `esp32-dummy`: `MQTT_URL=wss://mqtt-sijagakali.inspiralabs.id/mqtt MQTT_USERNAME=node-001 MQTT_PASSWORD=<pw> DEVICE_ID=node-001 READ_INTERVAL_SEC=30 npm start` | Log dummy `connected`; di Supabase: baris baru `mqtt_ingestion` (`dispatched_to_core`) dan `sensor_readings` node-001; `device_configs.last_seen_at` ter-update (≤2 menit) | |
| 2 | Notifikasi WA otomatis | Ulang #1 dengan `WATER_LEVEL_CM=<di atas threshold_waspada_cm node-001>` | `notification_logs` baris `status=sent`; pesan muncul di WA Channel | |
| 3 | Snapshot di notifikasi | `cctv_local_ip` node-001 terisi; reset cooldown (tunggu `notify_cooldown_waspada_sec` atau naikkan ke siaga); ulang #2 | WA berisi **gambar + teks**; objek ada di bucket `cctv-images/{slug}/node-001/{tanggal}/`; `sensor_readings.cctv_image_path` terisi | |
| 4 | ESP32-C5 asli | Isi `MQTT_PASSWORD` asli di `main.cpp` lokal (jangan commit), `pio run -t upload -t monitor` | Serial `MQTT: connected`; ulang cek #1 untuk data dari device asli | |
| 5 | ACL broker | `docker compose exec -e BACKEND_PASS=<pw> -e DEVICE_PASS=<pw> mosquitto sh /mosquitto/config/acl-check.sh` | `ACL OK` | |
| 6 | Live CCTV | Buka dashboard publik → tab Live → Putar live | Video main ≤10 s; setelah 5 menit muncul "Lanjut menonton"; tutup tab → `docker compose logs mediamtx` menunjukkan source ditutup ±70 s kemudian | |
| 7 | Snapshot manual | Admin → Pengaturan Perangkat node-001 → Ambil snapshot | Gambar tampil; toast "Snapshot tersimpan" | |
| 8 | OTA sukses | Naikkan `FIRMWARE_VERSION` ke `sijagakali-v1.0.1`, `pio run`, upload `.pio/build/esp32-c5-devkitc-1/firmware.bin` di `https://ota-sijagakali.inspiralabs.id`, deploy ke node-001 | `firmware_updates.status` sukses (ack `ok`), device reboot, `device_configs.firmware_version = sijagakali-v1.0.1` | |
| 9 | OTA gagal aman | Publish command dengan URL rusak: `docker compose exec mosquitto mosquitto_pub -u sijagakali-backend -P <pw> -t sijagakali/node-001/command -m '{"cmd":"ota_update","request_id":"bad-1","params":{"url":"https://ota-sijagakali.inspiralabs.id/tidak-ada.bin"}}'` | Ack `ok:false`; device tetap v1.0.1 dan tetap kirim data | |
| 10 | Foto tidak hilang | Setelah #3 (foto alarm), biarkan dummy kirim 2–3 data normal | Foto alarm tetap tampil di dashboard (tidak berubah jadi "Belum ada gambar") | |
| 11 | Snapshot berkala | Admin → Pengaturan Perangkat node-001 → isi "Snapshot berkala" = 1 → Simpan interval; tunggu ±2 menit | Foto di dashboard publik berganti sendiri (jam OSD di foto berubah) tanpa reload; `device_configs.last_snapshot_at` maju; tidak ada pesan WA dari snapshot berkala. Setelah uji, kembalikan ke 15 | |
| 12 | Sensor gangguan | ESP32 dengan firmware tanpa dummy (sijagakali-firmware PR #2) menyala, lalu cabut kabel sensor; tunggu > 10 menit (atau > 3× interval baca) | WA Channel: "⚠️ Sensor … gangguan"; colok lagi → setelah data masuk, WA "✅ … kembali normal" | |
| 13 | Perangkat offline | Cabut listrik ESP32; tunggu > 15 menit dan > 3× interval baca | WA Channel: "⚠️ Perangkat … offline"; nyalakan lagi → "✅ … kembali normal" | |
