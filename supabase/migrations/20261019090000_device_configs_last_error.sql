-- Galat sensor dari heartbeat firmware (sensor/status.last_error), ditulis mqtt-collector.
-- NULL = sensor terbaca normal. Dashboard memakai kolom ini + last_seen_at untuk menandai
-- data yang belum diperbarui (firmware >= v1.2.0 hanya mengirim data saat level berubah).
ALTER TABLE sijagakali.device_configs
  ADD COLUMN IF NOT EXISTS last_error text;
