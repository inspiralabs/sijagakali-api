-- Rename schema sijagaair -> sijagakali (brand rename, dev-only data, no backward-compat needed).
-- Schema rename cascades automatically to every table, function, trigger, and sequence inside it.
-- Guarded: a fresh bootstrap already creates the schema as `sijagakali` (historical migrations
-- were edited in place to the new name), so `sijagaair` won't exist there — only an existing
-- deployed database that still has the old schema needs this rename applied.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'sijagaair') THEN
    ALTER SCHEMA sijagaair RENAME TO sijagakali;
  END IF;
END $$;

-- SET search_path on a function is stored as a plain schema-name string, not tracked as a
-- dependency on the schema object, so it does NOT follow the rename above and must be fixed manually.
-- Harmless no-op on a fresh bootstrap, where it's already created with this search_path.
ALTER FUNCTION sijagakali.update_device_cctv_config(text, text, text, text)
  SET search_path = sijagakali, public;

-- Sync the seeded deployment slug on any database where it was already inserted under the old name.
-- device_configs/mqtt_ingestion/sensor_readings/threshold_history all carry
-- ON UPDATE CASCADE FKs back to deployments.slug, so updating the parent row propagates
-- automatically. notification_logs.deployment_slug has no FK (plain text column), so it needs
-- its own explicit update.
UPDATE sijagakali.deployments SET slug = 'sijagakali-bojong-kulur' WHERE slug = 'sijagaair-bojong-kulur';
UPDATE sijagakali.notification_logs SET deployment_slug = 'sijagakali-bojong-kulur' WHERE deployment_slug = 'sijagaair-bojong-kulur';
