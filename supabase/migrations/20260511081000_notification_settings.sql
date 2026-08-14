-- ============================================================
-- Tambah kolom template pesan WhatsApp per deployment
-- ============================================================
ALTER TABLE sijagakali.deployments
  ADD COLUMN IF NOT EXISTS whatsapp_message_template TEXT DEFAULT NULL;

-- NULL berarti pakai template default di kode notification-gateway.
-- Jika diisi, gunakan template dengan placeholder berikut:
--   {lokasi}       — location_name perangkat
--   {level_cm}     — ketinggian air dalam cm
--   {level_m}      — ketinggian air dalam meter
--   {status}       — label status (Siaga 4 — Normal, dsb.)
--   {waktu}        — waktu WIB (format lokal)
--   {dashboard_url} — URL dashboard publik
COMMENT ON COLUMN sijagakali.deployments.whatsapp_message_template
  IS 'Template pesan WhatsApp kustom per deployment. NULL = pakai default. Placeholder: {lokasi} {level_cm} {level_m} {status} {waktu} {dashboard_url}';
