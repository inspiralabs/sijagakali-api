-- Dashboard publik memakai kunci anon untuk membaca riwayat notifikasi terkirim.
-- Sebelumnya hanya `authenticated` yang punya SELECT + policy, sehingga /public dapat 401.

GRANT SELECT ON sijagaair.notification_logs TO anon;

DROP POLICY IF EXISTS "anon_read_notification_logs_sent" ON sijagaair.notification_logs;
CREATE POLICY "anon_read_notification_logs_sent"
  ON sijagaair.notification_logs
  FOR SELECT
  TO anon
  USING (status = 'sent');

COMMENT ON POLICY "anon_read_notification_logs_sent" ON sijagaair.notification_logs IS
  '/public: hanya baris status=sent boleh dibaca anon (tanpa login).';
