-- BMKG prakiraan cuaca per titik pantau + template WhatsApp cuaca

ALTER TABLE sijagaair.device_configs
  ADD COLUMN IF NOT EXISTS bmkg_adm4 TEXT,
  ADD COLUMN IF NOT EXISTS bmkg_nowcast_keywords TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN sijagaair.device_configs.bmkg_adm4 IS
  'Kode wilayah desa BMKG (ADM4), mis. 32.01.02.2002 untuk prakiraan cuaca.';
COMMENT ON COLUMN sijagaair.device_configs.bmkg_nowcast_keywords IS
  'Kata kunci filter peringatan dini BMKG nowcast untuk titik ini (lowercase).';

ALTER TABLE sijagaair.deployments
  ADD COLUMN IF NOT EXISTS wa_template_weather_nowcast TEXT,
  ADD COLUMN IF NOT EXISTS wa_template_weather_heavy_rain TEXT;

COMMENT ON COLUMN sijagaair.deployments.wa_template_weather_nowcast IS
  'WhatsApp: template peringatan dini cuaca BMKG (nowcast). Placeholder: {nama_pos}, {lokasi}, {cuaca}, {suhu}, {waktu}, {peringatan_bmkg}, {dashboard_url}, {kontak_petugas}, {no_bpbd}, {no_posko}, {wilayah}.';
COMMENT ON COLUMN sijagaair.deployments.wa_template_weather_heavy_rain IS
  'WhatsApp: template prakiraan hujan lebat/petir BMKG. Placeholder sama dengan wa_template_weather_nowcast.';

-- Seed awal: detail per device ada di 20260610130000_seed_bmkg_adm4_per_device.sql
