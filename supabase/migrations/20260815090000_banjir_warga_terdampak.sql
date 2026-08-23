-- Manajemen data warga terdampak banjir: wilayah (dusun/rw/rt berjenjang),
-- kejadian banjir, dan data warga per kejadian.
-- Lihat docs/superpowers/specs/2026-08-15-warga-terdampak-banjir-design.md

-- ============================================================
-- Master data wilayah — hierarki Dusun > RW > RT. RT/RW berulang lintas
-- wilayah induk di struktur administratif Indonesia, jadi berjenjang lewat
-- FK, bukan tiga daftar independen (supaya "RT 001" tidak ambigu).
-- ============================================================
CREATE TABLE IF NOT EXISTS sijagakali.wilayah_dusun (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_slug TEXT NOT NULL REFERENCES sijagakali.deployments (slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  nama            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (deployment_slug, nama)
);

CREATE TABLE IF NOT EXISTS sijagakali.wilayah_rw (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dusun_id   UUID NOT NULL REFERENCES sijagakali.wilayah_dusun (id) ON DELETE RESTRICT,
  nama       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (dusun_id, nama)
);

CREATE TABLE IF NOT EXISTS sijagakali.wilayah_rt (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rw_id      UUID NOT NULL REFERENCES sijagakali.wilayah_rw (id) ON DELETE RESTRICT,
  nama       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rw_id, nama)
);

CREATE INDEX IF NOT EXISTS idx_wilayah_dusun_deployment_slug ON sijagakali.wilayah_dusun (deployment_slug);
CREATE INDEX IF NOT EXISTS idx_wilayah_rw_dusun_id ON sijagakali.wilayah_rw (dusun_id);
CREATE INDEX IF NOT EXISTS idx_wilayah_rt_rw_id ON sijagakali.wilayah_rt (rw_id);

-- ============================================================
-- Kejadian banjir
-- ============================================================
CREATE TABLE IF NOT EXISTS sijagakali.banjir_events (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_slug  TEXT NOT NULL REFERENCES sijagakali.deployments (slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  nama             TEXT NOT NULL,
  tanggal_mulai    DATE NOT NULL,
  tanggal_selesai  DATE,
  keterangan       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_banjir_events_deployment_slug ON sijagakali.banjir_events (deployment_slug);

DROP TRIGGER IF EXISTS trg_banjir_events_updated_at ON sijagakali.banjir_events;
CREATE TRIGGER trg_banjir_events_updated_at
  BEFORE UPDATE ON sijagakali.banjir_events
  FOR EACH ROW EXECUTE PROCEDURE sijagakali.set_updated_at();

-- ============================================================
-- Warga terdampak banjir — satu baris = satu warga pada satu kejadian.
-- NIK unik per kejadian (bukan global): warga yang sama bisa tercatat lagi
-- di kejadian banjir yang berbeda.
-- ============================================================
CREATE TABLE IF NOT EXISTS sijagakali.warga_terdampak (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  banjir_event_id  UUID NOT NULL REFERENCES sijagakali.banjir_events (id) ON DELETE CASCADE,
  deployment_slug  TEXT NOT NULL REFERENCES sijagakali.deployments (slug) ON UPDATE CASCADE ON DELETE RESTRICT,
  nik              TEXT CHECK (nik IS NULL OR nik ~ '^[0-9]{16}$'),
  nama_lengkap     TEXT NOT NULL,
  tanggal_lahir    DATE NOT NULL,
  jenis_kelamin    TEXT NOT NULL CHECK (jenis_kelamin IN ('laki-laki', 'perempuan')),
  no_kk            TEXT,
  kontak_hp        TEXT,
  status_saat_ini  TEXT NOT NULL DEFAULT 'di_rumah' CHECK (status_saat_ini IN ('di_rumah', 'mengungsi', 'lainnya')),
  dusun_id         UUID NOT NULL REFERENCES sijagakali.wilayah_dusun (id) ON DELETE RESTRICT,
  rw_id            UUID NOT NULL REFERENCES sijagakali.wilayah_rw (id) ON DELETE RESTRICT,
  rt_id            UUID NOT NULL REFERENCES sijagakali.wilayah_rt (id) ON DELETE RESTRICT,
  detail_alamat    TEXT,
  catatan          TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_warga_terdampak_event_nik
  ON sijagakali.warga_terdampak (banjir_event_id, nik) WHERE nik IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_warga_terdampak_deployment_slug ON sijagakali.warga_terdampak (deployment_slug);
CREATE INDEX IF NOT EXISTS idx_warga_terdampak_banjir_event_id ON sijagakali.warga_terdampak (banjir_event_id);

DROP TRIGGER IF EXISTS trg_warga_terdampak_updated_at ON sijagakali.warga_terdampak;
CREATE TRIGGER trg_warga_terdampak_updated_at
  BEFORE UPDATE ON sijagakali.warga_terdampak
  FOR EACH ROW EXECUTE PROCEDURE sijagakali.set_updated_at();

-- ============================================================
-- RLS — pola sama seperti 20260512120000_authenticated_read_dashboard_tables.sql
-- ============================================================
ALTER TABLE sijagakali.wilayah_dusun ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.wilayah_rw ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.wilayah_rt ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.banjir_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE sijagakali.warga_terdampak ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_read_wilayah_dusun" ON sijagakali.wilayah_dusun;
CREATE POLICY "authenticated_read_wilayah_dusun"
  ON sijagakali.wilayah_dusun FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_wilayah_rw" ON sijagakali.wilayah_rw;
CREATE POLICY "authenticated_read_wilayah_rw"
  ON sijagakali.wilayah_rw FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_wilayah_rt" ON sijagakali.wilayah_rt;
CREATE POLICY "authenticated_read_wilayah_rt"
  ON sijagakali.wilayah_rt FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_banjir_events" ON sijagakali.banjir_events;
CREATE POLICY "authenticated_read_banjir_events"
  ON sijagakali.banjir_events FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated_read_warga_terdampak" ON sijagakali.warga_terdampak;
CREATE POLICY "authenticated_read_warga_terdampak"
  ON sijagakali.warga_terdampak FOR SELECT TO authenticated USING (true);

-- service_role bypass RLS secara default (tidak perlu policy eksplisit)

-- ============================================================
-- Grants
-- ============================================================
GRANT SELECT ON sijagakali.wilayah_dusun TO authenticated;
GRANT SELECT ON sijagakali.wilayah_rw TO authenticated;
GRANT SELECT ON sijagakali.wilayah_rt TO authenticated;
GRANT SELECT ON sijagakali.banjir_events TO authenticated;
GRANT SELECT ON sijagakali.warga_terdampak TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON sijagakali.wilayah_dusun TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sijagakali.wilayah_rw TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sijagakali.wilayah_rt TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sijagakali.banjir_events TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON sijagakali.warga_terdampak TO service_role;
