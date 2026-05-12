-- ============================================================
-- Admin accounts — link ke Supabase Auth (auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS sijagaair.admins (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL UNIQUE,
  display_name TEXT,
  is_default   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- Trigger: blokir DELETE jika is_default = true
-- ============================================================
CREATE OR REPLACE FUNCTION sijagaair.prevent_default_admin_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.is_default THEN
    RAISE EXCEPTION 'Admin default tidak dapat dihapus dari sistem';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prevent_default_admin_delete ON sijagaair.admins;
CREATE TRIGGER prevent_default_admin_delete
  BEFORE DELETE ON sijagaair.admins
  FOR EACH ROW EXECUTE FUNCTION sijagaair.prevent_default_admin_delete();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE sijagaair.admins ENABLE ROW LEVEL SECURITY;

-- Admin bisa melihat dirinya sendiri
DROP POLICY IF EXISTS "admins_read_self" ON sijagaair.admins;
CREATE POLICY "admins_read_self"
  ON sijagaair.admins FOR SELECT TO authenticated
  USING (id = auth.uid());

-- service_role bypass RLS secara default (tidak perlu policy eksplisit)

-- ============================================================
-- Grant
-- ============================================================
GRANT SELECT ON sijagaair.admins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sijagaair.admins TO service_role;
