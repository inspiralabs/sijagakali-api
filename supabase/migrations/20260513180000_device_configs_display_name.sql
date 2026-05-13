-- Nama singkat untuk daftar/dashboard; detail lokasi tetap di location_name.
ALTER TABLE sijagaair.device_configs
  ADD COLUMN IF NOT EXISTS display_name TEXT;

COMMENT ON COLUMN sijagaair.device_configs.display_name IS 'Nama singkat perangkat untuk tabel/UI; lokasi narasi di location_name.';

-6.38309242589151, 