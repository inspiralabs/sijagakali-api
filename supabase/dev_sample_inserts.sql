-- =============================================================================
-- Contoh INSERT / UPDATE manual untuk uji di Supabase SQL Editor (superuser).
-- Pastikan migrasi init + seed sudah jalan; kalau belum, jalankan dulu:
--   20260209120000_init_sijagaair_core.sql
--   20260209120100_seed_bojong_kulur_dev.sql
-- =============================================================================

-- Konstanta uji: ganti slug di query bawah jika deployment lain.

-- ---------------------------------------------------------------------------
-- 1) deployments — baris wilayah + template WhatsApp per status + kontak contoh
--    (selaras shared/waBuiltinTemplates.ts & UI DeviceSettings; migrasi kolom: 20260513120000)
-- ---------------------------------------------------------------------------
INSERT INTO sijagaair.deployments (slug, display_name)
VALUES ('sijagaair-bojong-kulur', 'SiJagaAir — Bojong Kulur')
ON CONFLICT (slug) DO NOTHING;

UPDATE sijagaair.deployments
SET
  whatsapp_message_template = NULL,
  wa_template_normal = $wa_n$
━━━━━━━━━━━━━━━━━━━━
🌊 *SiJagaAir | Laporan Muka Air*
📍 Pos Pantau: *{nama_pos}*
🏘️ Wilayah: *{wilayah}*
━━━━━━━━━━━━━━━━━━━━

📏 *Tinggi Muka Air*
  Saat ini : *{level_cm} cm* (~{level_m} m)
  Ambang waspada : {batas_waspada} cm
  Ambang siaga : {batas_siaga} cm

🟢 *Status: NORMAL*
Kondisi aman. Tidak ada ancaman banjir.

🕐 Waktu pencatatan (WIB): {waktu}
🔁 Update berikutnya: ±{interval} menit

📊 *Pantau live:* {dashboard_url}
━━━━━━━━━━━━━━━━━━━━
_Pesan otomatis oleh SiJagaAir_
$wa_n$,
  wa_template_waspada = $wa_w$
━━━━━━━━━━━━━━━━━━━━
⚠️ *SiJagaAir | PERINGATAN DINI*
📍 Pos Pantau: *{nama_pos}*
🏘️ Wilayah: *{wilayah}*
━━━━━━━━━━━━━━━━━━━━

📏 *Tinggi Muka Air*
  Saat ini : *{level_cm} cm* (~{level_m} m)  ⬆️ naik {selisih} cm
  Ambang waspada : {batas_waspada} cm ✅ Terlampaui
  Ambang siaga : {batas_siaga} cm

🟡 *Status: WASPADA*
Air mulai meningkat. Harap pantau kondisi sekitar
dan waspada terhadap kemungkinan banjir.

🕐 Waktu (WIB): {waktu}
📊 *Pantau live:* {dashboard_url}

📞 Info lebih lanjut: {kontak_petugas}
━━━━━━━━━━━━━━━━━━━━
_Pesan otomatis oleh SiJagaAir_
$wa_w$,
  wa_template_siaga = $wa_s$
🚨🚨🚨 *PERINGATAN BAHAYA* 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━
🌊 *SiJagaAir | SIAGA BANJIR*
📍 Pos Pantau: *{nama_pos}*
🏘️ Wilayah: *{wilayah}*
━━━━━━━━━━━━━━━━━━━━

📏 *Tinggi Muka Air*
  Saat ini : ⚠️ *{level_cm} cm* (~{level_m} m)
  Ambang siaga : {batas_siaga} cm — 🔴 TERLAMPAUI

🔴 *Status: SIAGA*
Ketinggian air sudah melewati batas siaga.
Warga di bantaran sungai harap segera
bersiap untuk evakuasi.

🕐 Waktu (WIB): {waktu}

🆘 *Hubungi segera:*
  BPBD : {no_bpbd}
  Posko Desa : {no_posko}

📊 *Pantau live:* {dashboard_url}
━━━━━━━━━━━━━━━━━━━━
_Pesan otomatis oleh SiJagaAir_
$wa_s$,
  wa_template_bahaya = $wa_b$
🚨🚨🚨 *PERINGATAN BAHAYA* 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━
🌊 *SiJagaAir | BAHAYA BANJIR*
📍 Pos Pantau: *{nama_pos}*
🏘️ Wilayah: *{wilayah}*
━━━━━━━━━━━━━━━━━━━━

📏 *Tinggi Muka Air*
  Saat ini : ⚠️ *{level_cm} cm* (~{level_m} m)
  Ambang bahaya : {batas_bahaya} cm — 🔴 TERLAMPAUI

🔴 *Status: BAHAYA*
Ketinggian air sudah melewati batas bahaya.
Warga di bantaran sungai harap segera
bersiap untuk evakuasi.

🕐 Waktu (WIB): {waktu}

🆘 *Hubungi segera:*
  BPBD : {no_bpbd}
  Posko Desa : {no_posko}

📊 *Pantau live:* {dashboard_url}
━━━━━━━━━━━━━━━━━━━━
_Pesan otomatis oleh SiJagaAir_
$wa_b$,
  contact_petugas = 'Petugas Banjir (08123456789)',
  contact_bpbd = 'BPBD setempat (ganti: 112 / nomor daerah)',
  contact_posko = 'Posko desa (08123456789)'
WHERE slug = 'sijagaair-bojong-kulur';

-- ---------------------------------------------------------------------------
-- 2) device_configs — titik pantau (idempoten)
-- ---------------------------------------------------------------------------
INSERT INTO sijagaair.device_configs (
  deployment_slug,
  device_id,
  location_name,
  sensor_height_cm,
  cctv_local_ip,
  stream_playback_url,
  read_interval_sec,
  threshold_waspada_cm,
  threshold_siaga_cm,
  threshold_bahaya_cm,
  is_active,
  last_seen_at
) VALUES
  (
    'sijagaair-bojong-kulur',
    'node-001',
    'Titik pantau 1',
    250,
    '192.168.1.101',
    NULL,
    3600,
    100,
    150,
    200,
    true,
    now()
  ),
  (
    'sijagaair-bojong-kulur',
    'node-002',
    'Titik pantau 2',
    250,
    NULL,
    NULL,
    3600,
    100,
    150,
    200,
    true,
    now()
  ),
  (
    'sijagaair-bojong-kulur',
    'node-003',
    'Titik pantau 3',
    250,
    NULL,
    NULL,
    3600,
    100,
    150,
    200,
    true,
    now()
  )
ON CONFLICT (deployment_slug, device_id) DO UPDATE SET
  location_name    = excluded.location_name,
  sensor_height_cm = excluded.sensor_height_cm,
  cctv_local_ip    = excluded.cctv_local_ip,
  last_seen_at     = excluded.last_seen_at,
  stream_playback_url = coalesce(
    excluded.stream_playback_url,
    device_configs.stream_playback_url
  );

-- ---------------------------------------------------------------------------
-- 3) sensor_readings — contoh beberapa baris (Realtime + dashboard)
-- ---------------------------------------------------------------------------
-- Contoh path — unggah JPEG ke bucket `cctv-images` dengan key yang sama persis:
-- sijagaair-bojong-kulur/node-001/2026-05-09/20260509T084012_node-001.jpg
-- sijagaair-bojong-kulur/node-002/2026-05-09/20260509T084012_node-002.jpg
-- sijagaair-bojong-kulur/node-003/2026-05-09/20260509T084012_node-003.jpg
--
-- Unggahan flat (tanpa slug), contoh: node-001/2025-05-09/20260509T084012_node-001.jpg —
-- backend mencoba beberapa variasi key otomatis; idealnya key Storage = `cctv_image_path` di DB.

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
    165,
    'siaga',
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
    120,
    'waspada',
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
    210,
    'bahaya',
    -55,
    79,
    'sijagaair-bojong-kulur/node-003/2026-05-09/20260509T084012_node-003.jpg',
    now(),
    gen_random_uuid()
  );

INSERT INTO sijagaair.sensor_readings (
  deployment_slug, device_id, recorded_at,
  water_level_cm, water_status, rssi, battery_pct,
  cctv_image_path, cctv_captured_at, correlation_id
) VALUES (
  'sijagaair-bojong-kulur', 'node-001', now(),
  884, 'siaga', -60, 82,
  'sijagaair-bojong-kulur/node-001/2026-05-09/20260509T084012_node-001.jpg',
  now(),
  gen_random_uuid()
);

-- ---------------------------------------------------------------------------
-- 4) mqtt_ingestion — staging pipeline (sensor_data / cctv_image)
--    UNIQUE (deployment_slug, correlation_id, message_type)
-- ---------------------------------------------------------------------------
INSERT INTO sijagaair.mqtt_ingestion (
  deployment_slug,
  device_id,
  correlation_id,
  message_type,
  payload_json,
  cctv_storage_path,
  ingest_status
) VALUES
  (
    'sijagaair-bojong-kulur',
    'node-001',
    gen_random_uuid(),
    'sensor_data',
    '{"water_level_cm": 120, "battery_pct": 90}'::jsonb,
    NULL,
    'parsed_ok'
  ),
  (
    'sijagaair-bojong-kulur',
    'node-001',
    gen_random_uuid(),
    'cctv_image',
    NULL,
    'sijagaair-bojong-kulur/node-001/2026-05-12/demo.jpg',
    'storage_uploaded'
  );

-- ---------------------------------------------------------------------------
-- 5) notification_logs — contoh terkirim (anon /public hanya baca status=sent)
--    reading_id opsional: mengait ke sensor_readings terbaru node-001
-- ---------------------------------------------------------------------------
INSERT INTO sijagaair.notification_logs (
  reading_id,
  deployment_slug,
  device_id,
  water_status,
  channel,
  status,
  sent_at
)
SELECT
  sr.id,
  'sijagaair-bojong-kulur',
  'node-001',
  'siaga',
  'whatsapp',
  'sent',
  now() - interval '10 minutes'
FROM sijagaair.sensor_readings sr
WHERE sr.deployment_slug = 'sijagaair-bojong-kulur'
  AND sr.device_id = 'node-001'
ORDER BY sr.recorded_at DESC
LIMIT 1;

INSERT INTO sijagaair.notification_logs (
  deployment_slug,
  device_id,
  water_status,
  channel,
  status,
  error_message,
  sent_at
) VALUES (
  'sijagaair-bojong-kulur',
  'node-002',
  'bahaya',
  'whatsapp',
  'failed',
  'Gateway timeout (contoh gagal kirim)',
  now() - interval '1 hour'
);

-- ---------------------------------------------------------------------------
-- 6) threshold_history — audit perubahan ambang (contoh)
-- ---------------------------------------------------------------------------
INSERT INTO sijagaair.threshold_history (
  deployment_slug,
  device_id,
  changed_by,
  old_values,
  new_values
) VALUES (
  'sijagaair-bojong-kulur',
  'node-001',
  'admin@contoh.dev',
  '{"threshold_waspada_cm": 100, "threshold_siaga_cm": 150, "threshold_bahaya_cm": 200}'::jsonb,
  '{"threshold_waspada_cm": 95, "threshold_siaga_cm": 145, "threshold_bahaya_cm": 195}'::jsonb
);

-- ---------------------------------------------------------------------------
-- 7) admins — HARUS id = auth.users.id (buat user di Authentication dulu)
--    Jangan insert UUID sembarang; foreign key akan gagal.
--
--    Setelah user ada di Dashboard → Authentication, ambil UUID-nya lalu:
--
-- INSERT INTO sijagaair.admins (id, email, display_name, is_default)
-- VALUES (
--   '00000000-0000-0000-0000-000000000000'::uuid,  -- ganti dengan auth.users.id
--   'admin@sijagaair.com',
--   'Admin Utama',
--   true
-- )
-- ON CONFLICT (id) DO NOTHING;
-- ---------------------------------------------------------------------------

-- Verifikasi cepat
SELECT 'deployments' AS t, count(*) FROM sijagaair.deployments WHERE slug = 'sijagaair-bojong-kulur'
UNION ALL
SELECT 'device_configs', count(*) FROM sijagaair.device_configs WHERE deployment_slug = 'sijagaair-bojong-kulur'
UNION ALL
SELECT 'sensor_readings', count(*) FROM sijagaair.sensor_readings WHERE deployment_slug = 'sijagaair-bojong-kulur'
UNION ALL
SELECT 'mqtt_ingestion', count(*) FROM sijagaair.mqtt_ingestion WHERE deployment_slug = 'sijagaair-bojong-kulur'
UNION ALL
SELECT 'notification_logs', count(*) FROM sijagaair.notification_logs WHERE deployment_slug = 'sijagaair-bojong-kulur'
UNION ALL
SELECT 'threshold_history', count(*) FROM sijagaair.threshold_history WHERE deployment_slug = 'sijagaair-bojong-kulur';
