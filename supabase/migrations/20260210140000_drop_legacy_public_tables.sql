-- OPSIONAL — hanya jika Anda pernah menjalankan versi lama migrasi di schema `public`.
-- Hapus komentar baris DROP di bawah satu per satu, atau salin ke SQL Editor secara selektif.
-- Jangan jalankan di production tanpa backup.

-- ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.sensor_readings;
-- ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.mqtt_ingestion;

-- DROP TABLE IF EXISTS public.threshold_history CASCADE;
-- DROP TABLE IF EXISTS public.notification_logs CASCADE;
-- DROP TABLE IF EXISTS public.sensor_readings CASCADE;
-- DROP TABLE IF EXISTS public.mqtt_ingestion CASCADE;
-- DROP TABLE IF EXISTS public.device_configs CASCADE;
-- DROP TABLE IF EXISTS public.deployments CASCADE;
-- DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;

SELECT 1 AS skip_legacy_cleanup_by_default;
