-- SiJagaKali — schema aplikasi `sijagakali` (multi-wilayah via deployment_slug)
-- Selaras rencana: satu schema Postgres untuk semua instalasi SiJagaKali.
-- Jalankan: psql "$DIRECT_URL" -f supabase/migrations/20260209120000_init_sijagakali_core.sql
-- Setelah sukses: Supabase Dashboard → Settings → API → Exposed schemas → tambahkan `sijagakali`

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE SCHEMA IF NOT EXISTS sijagakali;

GRANT USAGE ON SCHEMA sijagakali TO postgres, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- deployments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sijagakali.deployments (
  slug          TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- device_configs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sijagakali.device_configs (
  deployment_slug             TEXT NOT NULL REFERENCES sijagakali.deployments (slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  device_id                   TEXT NOT NULL,
  location_name               TEXT NOT NULL,
  display_name                TEXT,
  sensor_height_cm            DOUBLE PRECISION NOT NULL,
  cctv_local_ip               TEXT,
  stream_playback_url         TEXT,
  mac_address                 TEXT,
  latitude                    DOUBLE PRECISION,
  longitude                   DOUBLE PRECISION,
  read_interval_sec           INTEGER NOT NULL DEFAULT 3600,
  threshold_waspada_cm        DOUBLE PRECISION NOT NULL DEFAULT 100,
  threshold_siaga_cm          DOUBLE PRECISION NOT NULL DEFAULT 150,
  threshold_bahaya_cm         DOUBLE PRECISION NOT NULL DEFAULT 200,
  notify_digest_hours_local   INTEGER[] NOT NULL DEFAULT ARRAY[8, 12, 17, 21]::INTEGER[],
  notify_surge_delta_cm       DOUBLE PRECISION NOT NULL DEFAULT 15,
  notify_surge_window_min     INTEGER NOT NULL DEFAULT 60,
  notify_cooldown_waspada_sec INTEGER NOT NULL DEFAULT 7200,
  notify_cooldown_siaga_sec   INTEGER NOT NULL DEFAULT 3600,
  notify_cooldown_bahaya_sec  INTEGER NOT NULL DEFAULT 900,
  is_active                   BOOLEAN NOT NULL DEFAULT true,
  last_seen_at                TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (deployment_slug, device_id),
  CONSTRAINT chk_threshold_order CHECK (
    threshold_waspada_cm < threshold_siaga_cm
    AND threshold_siaga_cm < threshold_bahaya_cm
  ),
  CONSTRAINT chk_digest_hours_nonempty CHECK (cardinality(notify_digest_hours_local) >= 1)
);

CREATE INDEX IF NOT EXISTS idx_device_configs_active
  ON sijagakali.device_configs (deployment_slug)
  WHERE is_active = true;

-- ---------------------------------------------------------------------------
-- mqtt_ingestion (staging)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sijagakali.mqtt_ingestion (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_slug     TEXT NOT NULL,
  device_id           TEXT NOT NULL,
  correlation_id      UUID NOT NULL,
  message_type        TEXT NOT NULL CHECK (message_type IN ('sensor_data', 'cctv_image')),
  payload_json        JSONB,
  cctv_storage_path   TEXT,
  ingest_status       TEXT NOT NULL DEFAULT 'received'
    CHECK (ingest_status IN (
      'received',
      'parsed_ok',
      'storage_uploaded',
      'failed',
      'ready_for_core',
      'dispatched_to_core'
    )),
  error_message       TEXT,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_mqtt_ingestion_device
    FOREIGN KEY (deployment_slug, device_id)
    REFERENCES sijagakali.device_configs (deployment_slug, device_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_mqtt_ingestion_correlation
  ON sijagakali.mqtt_ingestion (correlation_id);

CREATE INDEX IF NOT EXISTS idx_mqtt_ingestion_device_time
  ON sijagakali.mqtt_ingestion (deployment_slug, device_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_mqtt_ingestion_processing
  ON sijagakali.mqtt_ingestion (ingest_status)
  WHERE ingest_status IN ('received', 'parsed_ok', 'storage_uploaded', 'ready_for_core');

CREATE UNIQUE INDEX IF NOT EXISTS uq_mqtt_ingestion_deploy_corr_type
  ON sijagakali.mqtt_ingestion (deployment_slug, correlation_id, message_type);

-- ---------------------------------------------------------------------------
-- sensor_readings (inti)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sijagakali.sensor_readings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_slug     TEXT NOT NULL,
  device_id           TEXT NOT NULL,
  recorded_at         TIMESTAMPTZ NOT NULL,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  water_level_cm      DOUBLE PRECISION NOT NULL,
  water_status        TEXT CHECK (water_status IN ('normal', 'waspada', 'siaga', 'bahaya')),
  cctv_image_path     TEXT,
  cctv_captured_at    TIMESTAMPTZ,
  rssi                INTEGER,
  battery_pct         INTEGER,
  correlation_id      UUID,
  CONSTRAINT fk_sensor_readings_device
    FOREIGN KEY (deployment_slug, device_id)
    REFERENCES sijagakali.device_configs (deployment_slug, device_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_time
  ON sijagakali.sensor_readings (deployment_slug, device_id, recorded_at DESC);

-- ---------------------------------------------------------------------------
-- notification_logs
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sijagakali.notification_logs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reading_id        UUID REFERENCES sijagakali.sensor_readings (id) ON DELETE SET NULL,
  deployment_slug   TEXT,
  device_id         TEXT,
  water_status      TEXT,
  channel           TEXT NOT NULL DEFAULT 'whatsapp',
  status            TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message     TEXT,
  sent_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_device_time
  ON sijagakali.notification_logs (deployment_slug, device_id, sent_at DESC);

-- ---------------------------------------------------------------------------
-- threshold_history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sijagakali.threshold_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_slug   TEXT NOT NULL,
  device_id         TEXT NOT NULL,
  changed_by        TEXT,
  old_values        JSONB,
  new_values        JSONB,
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fk_threshold_history_device
    FOREIGN KEY (deployment_slug, device_id)
    REFERENCES sijagakali.device_configs (deployment_slug, device_id)
    ON UPDATE CASCADE ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Trigger updated_at
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sijagakali.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_device_configs_updated_at ON sijagakali.device_configs;
CREATE TRIGGER trg_device_configs_updated_at
  BEFORE UPDATE ON sijagakali.device_configs
  FOR EACH ROW
  EXECUTE PROCEDURE sijagakali.set_updated_at();

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sijagakali.sensor_readings;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE sijagakali.mqtt_ingestion;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT SELECT ON sijagakali.deployments TO anon, authenticated;
GRANT SELECT ON sijagakali.device_configs TO anon, authenticated;
GRANT SELECT ON sijagakali.sensor_readings TO anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sijagakali TO service_role;

GRANT SELECT, UPDATE ON sijagakali.device_configs TO authenticated;
GRANT SELECT ON sijagakali.deployments TO authenticated;
GRANT SELECT ON sijagakali.sensor_readings TO authenticated;
GRANT SELECT ON sijagakali.notification_logs TO authenticated;
GRANT SELECT ON sijagakali.threshold_history TO authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE sijagakali.deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.device_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.sensor_readings ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.mqtt_ingestion ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.threshold_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_read_deployments" ON sijagakali.deployments;
CREATE POLICY "anon_read_deployments"
  ON sijagakali.deployments FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon_read_device_configs" ON sijagakali.device_configs;
CREATE POLICY "anon_read_device_configs"
  ON sijagakali.device_configs FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "anon_read_sensor_readings" ON sijagakali.sensor_readings;
CREATE POLICY "anon_read_sensor_readings"
  ON sijagakali.sensor_readings FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "authenticated_read_mqtt_ingestion" ON sijagakali.mqtt_ingestion;
CREATE POLICY "authenticated_read_mqtt_ingestion"
  ON sijagakali.mqtt_ingestion FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_notification_logs" ON sijagakali.notification_logs;
CREATE POLICY "authenticated_read_notification_logs"
  ON sijagakali.notification_logs FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_threshold_history" ON sijagakali.threshold_history;
CREATE POLICY "authenticated_read_threshold_history"
  ON sijagakali.threshold_history FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_update_device_configs" ON sijagakali.device_configs;
CREATE POLICY "authenticated_update_device_configs"
  ON sijagakali.device_configs FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
