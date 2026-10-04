-- Suhu CPU Raspberry Pi lokasi (topik MQTT cctv/pi-status), ditulis mqtt-collector.
-- pi_temp_at = jam server saat diterima; dashboard menampilkan suhu bila <= 10 menit.
ALTER TABLE sijagakali.device_configs
  ADD COLUMN IF NOT EXISTS pi_temp_c numeric(5,1),
  ADD COLUMN IF NOT EXISTS pi_temp_at timestamptz;
