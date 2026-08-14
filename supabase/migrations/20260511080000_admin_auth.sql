-- ============================================================
-- Admin accounts — link ke Supabase Auth (auth.users)
-- ============================================================
CREATE TABLE IF NOT EXISTS sijagakali.admins (
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
CREATE OR REPLACE FUNCTION sijagakali.prevent_default_admin_delete()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF OLD.is_default THEN
    RAISE EXCEPTION 'Admin default tidak dapat dihapus dari sistem';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS prevent_default_admin_delete ON sijagakali.admins;
CREATE TRIGGER prevent_default_admin_delete
  BEFORE DELETE ON sijagakali.admins
  FOR EACH ROW EXECUTE FUNCTION sijagakali.prevent_default_admin_delete();

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE sijagakali.admins ENABLE ROW LEVEL SECURITY;

-- Admin bisa melihat dirinya sendiri
DROP POLICY IF EXISTS "admins_read_self" ON sijagakali.admins;
CREATE POLICY "admins_read_self"
  ON sijagakali.admins FOR SELECT TO authenticated
  USING (id = auth.uid());

-- service_role bypass RLS secara default (tidak perlu policy eksplisit)

-- ============================================================
-- Grant
-- ============================================================
GRANT SELECT ON sijagakali.admins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON sijagakali.admins TO service_role;
