-- Snapshot CCTV: interval berkala per device (diatur admin) + foto terbaru untuk dashboard.
ALTER TABLE sijagakali.device_configs
  ADD COLUMN IF NOT EXISTS snapshot_interval_min integer NOT NULL DEFAULT 15
    CHECK (snapshot_interval_min >= 0 AND snapshot_interval_min <= 1440),
  ADD COLUMN IF NOT EXISTS last_snapshot_path text,
  ADD COLUMN IF NOT EXISTS last_snapshot_at timestamptz;

COMMENT ON COLUMN sijagakali.device_configs.snapshot_interval_min IS
  'Menit antar snapshot berkala CCTV; 0 = mati. Snapshot kejadian & manual tetap jalan.';

-- Dashboard menerima foto terbaru secara realtime (UPDATE device_configs).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sijagakali.device_configs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
