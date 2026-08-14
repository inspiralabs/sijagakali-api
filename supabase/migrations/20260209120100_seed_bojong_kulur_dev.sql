-- Seed contoh: satu deployment + 3 node (idempoten dengan ON CONFLICT)
-- Tabel berada di schema `sijagakali` (jalankan setelah init_sijagakali_core.sql)

INSERT INTO sijagakali.deployments (slug, display_name)
VALUES ('sijagakali-bojong-kulur', 'SiJagaKali — Bojong Kulur')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO sijagakali.device_configs (
  deployment_slug,
  device_id,
  location_name,
  sensor_height_cm,
  cctv_local_ip,
  read_interval_sec,
  threshold_waspada_cm,
  threshold_siaga_cm,
  threshold_bahaya_cm
) VALUES
  ('sijagakali-bojong-kulur', 'node-001', 'Titik pantau 1', 200, NULL, 3600, 100, 150, 200),
  ('sijagakali-bojong-kulur', 'node-002', 'Titik pantau 2', 200, NULL, 3600, 100, 150, 200),
  ('sijagakali-bojong-kulur', 'node-003', 'Titik pantau 3', 200, NULL, 3600, 100, 150, 200)
ON CONFLICT (deployment_slug, device_id) DO NOTHING;
