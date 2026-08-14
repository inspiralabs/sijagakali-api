-- BMKG prakiraan cuaca per titik pantau (ADM4)

ALTER TABLE sijagakali.device_configs
  ADD COLUMN IF NOT EXISTS bmkg_adm4 TEXT;

COMMENT ON COLUMN sijagakali.device_configs.bmkg_adm4 IS
  'Kode wilayah desa BMKG (ADM4), mis. 32.01.02.2002 untuk prakiraan cuaca.';

-- Seed awal: detail per device ada di 20260610130000_seed_bmkg_adm4_per_device.sql
