-- Kolom URL live stream CCTV per titik pantau (opsional).
-- Untuk DB yang sudah dibuat dari init sebelum kolom ini ada. Aman berulang (IF NOT EXISTS).

ALTER TABLE sijagakali.device_configs
  ADD COLUMN IF NOT EXISTS stream_playback_url TEXT;

COMMENT ON COLUMN sijagakali.device_configs.stream_playback_url IS
  'URL playback live (HLS m3u8, WebRTC, atau mp4 dummy). Snapshot per pembacaan: sensor_readings.cctv_image_path.';
