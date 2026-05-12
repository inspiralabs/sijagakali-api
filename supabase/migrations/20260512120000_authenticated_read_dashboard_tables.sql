-- Policy SELECT untuk role `authenticated` pada tabel dashboard.
-- Init hanya punya policy SELECT ke `anon`; setelah fetch menunggu sesi (JWT authenticated),
-- tanpa policy ini PostgREST mengembalikan 0 baris walau GRANT SELECT ada.

DROP POLICY IF EXISTS "authenticated_read_deployments" ON sijagaair.deployments;
CREATE POLICY "authenticated_read_deployments"
  ON sijagaair.deployments FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_device_configs" ON sijagaair.device_configs;
CREATE POLICY "authenticated_read_device_configs"
  ON sijagaair.device_configs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_sensor_readings" ON sijagaair.sensor_readings;
CREATE POLICY "authenticated_read_sensor_readings"
  ON sijagaair.sensor_readings FOR SELECT TO authenticated USING (true);

COMMENT ON POLICY "authenticated_read_deployments" ON sijagaair.deployments IS
  'Admin (Supabase Auth): baca deployment untuk dashboard.';
COMMENT ON POLICY "authenticated_read_device_configs" ON sijagaair.device_configs IS
  'Admin: baca konfigurasi perangkat; UPDATE tetap policy terpisah.';
COMMENT ON POLICY "authenticated_read_sensor_readings" ON sijagaair.sensor_readings IS
  'Admin: baca reading sensor untuk dashboard dan grafik.';
