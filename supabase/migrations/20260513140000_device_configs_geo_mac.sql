-- Lokasi perangkat & identitas jaringan untuk dashboard (sebelumnya hanya fallback di kode).
ALTER TABLE sijagakali.device_configs
  ADD COLUMN IF NOT EXISTS mac_address TEXT,
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

COMMENT ON COLUMN sijagakali.device_configs.mac_address IS 'MAC / identitas node lapangan (opsional).';
COMMENT ON COLUMN sijagakali.device_configs.latitude IS 'Lintang peta (opsional).';
COMMENT ON COLUMN sijagakali.device_configs.longitude IS 'Bujur peta (opsional).';
