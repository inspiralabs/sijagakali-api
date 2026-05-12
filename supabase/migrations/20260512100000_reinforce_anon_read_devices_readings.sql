-- Memastikan dashboard /public (kunci anon) tetap bisa SELECT device_configs + sensor_readings
-- jika policy/GRANT sempat hilang atau DB dibuat manual tanpa init penuh.
-- Editor SQL Supabase memakai role superuser sehingga tidak memperlihatkan masalah RLS anon.

GRANT USAGE ON SCHEMA sijagaair TO anon;
GRANT SELECT ON sijagaair.device_configs TO anon;
GRANT SELECT ON sijagaair.sensor_readings TO anon;

DROP POLICY IF EXISTS "anon_read_device_configs" ON sijagaair.device_configs;
CREATE POLICY "anon_read_device_configs"
  ON sijagaair.device_configs FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon_read_sensor_readings" ON sijagaair.sensor_readings;
CREATE POLICY "anon_read_sensor_readings"
  ON sijagaair.sensor_readings FOR SELECT TO anon USING (true);

COMMENT ON POLICY "anon_read_device_configs" ON sijagaair.device_configs IS
  'Dashboard publik: anon boleh baca konfigurasi perangkat (filter slug di aplikasi).';
COMMENT ON POLICY "anon_read_sensor_readings" ON sijagaair.sensor_readings IS
  'Dashboard publik: anon boleh baca riwayat/reading sensor (filter slug di aplikasi).';
