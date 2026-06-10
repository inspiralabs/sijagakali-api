-- =============================================================================
-- Contoh INSERT sensor_readings untuk uji di Supabase SQL Editor.
-- Prasyarat: migrasi init + device_configs sudah ada (minimal node-001..003
-- di deployment sijagaair-bojong-kulur). Lihat dev_sample_inserts.sql bagian
-- device_configs atau 20260209120100_seed_bojong_kulur_dev.sql.
-- =============================================================================

-- Contoh path CCTV — unggah JPEG ke bucket `cctv-images` dengan key yang sama:
-- sijagaair-bojong-kulur/node-001/2026-05-09/20260509T084012_node-001.jpg
-- sijagaair-bojong-kulur/node-002/2026-05-09/20260509T084012_node-002.jpg
-- sijagaair-bojong-kulur/node-003/2026-05-09/20260509T084012_node-003.jpg

INSERT INTO sijagaair.sensor_readings (
  deployment_slug,
  device_id,
  recorded_at,
  water_level_cm,
  water_status,
  rssi,
  battery_pct,
  cctv_image_path,
  cctv_captured_at,
  correlation_id
) VALUES
  (
    'sijagaair-bojong-kulur',
    'node-001',
    now() - interval '2 hours',
    72,
    'normal',
    -62,
    88,
    'sijagaair-bojong-kulur/node-001/2026-05-09/20260509T084012_node-001.jpg',
    now() - interval '2 hours',
    gen_random_uuid()
  ),
  (
    'sijagaair-bojong-kulur',
    'node-001',
    now() - interval '5 minutes',
    65,
    'normal',
    -58,
    84,
    'sijagaair-bojong-kulur/node-001/2026-05-09/20260509T084012_node-001.jpg',
    now() - interval '5 minutes',
    gen_random_uuid()
  ),
  (
    'sijagaair-bojong-kulur',
    'node-002',
    now() - interval '1 minute',
    80,
    'normal',
    -70,
    91,
    'sijagaair-bojong-kulur/node-002/2026-05-09/20260509T084012_node-002.jpg',
    now() - interval '1 minute',
    gen_random_uuid()
  ),
  (
    'sijagaair-bojong-kulur',
    'node-003',
    now(),
    150,
    'normal',
    -55,
    79,
    'sijagaair-bojong-kulur/node-003/2026-05-09/20260509T084012_node-003.jpg',
    now(),
    gen_random_uuid()
  );

-- Verifikasi
SELECT count(*) AS sensor_readings_count
FROM sijagaair.sensor_readings
WHERE deployment_slug = 'sijagaair-bojong-kulur';
