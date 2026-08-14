-- SiJagaKali: template WhatsApp per water_status + kontak darurat (per deployment).
-- wa_template_* dipakai UI admin & gateway; whatsapp_message_template (lama) tetap ada
-- sebagai fallback di kode bila semua wa_template_* kosong — tidak diwajibkan diisi.

ALTER TABLE sijagakali.deployments
  ADD COLUMN IF NOT EXISTS wa_template_normal TEXT,
  ADD COLUMN IF NOT EXISTS wa_template_waspada TEXT,
  ADD COLUMN IF NOT EXISTS wa_template_siaga TEXT,
  ADD COLUMN IF NOT EXISTS wa_template_bahaya TEXT,
  ADD COLUMN IF NOT EXISTS contact_petugas TEXT,
  ADD COLUMN IF NOT EXISTS contact_bpbd TEXT,
  ADD COLUMN IF NOT EXISTS contact_posko TEXT;

COMMENT ON COLUMN sijagakali.deployments.wa_template_normal IS 'WhatsApp: template jika water_status=normal (placeholder: {nama_pos}, {wilayah}, {level_cm}, {interval}, dll.).';
COMMENT ON COLUMN sijagakali.deployments.wa_template_waspada IS 'WhatsApp: template jika water_status=waspada (termasuk {selisih}, {kontak_petugas}).';
COMMENT ON COLUMN sijagakali.deployments.wa_template_siaga IS 'WhatsApp: template jika water_status=siaga ({no_bpbd}, {no_posko}).';
COMMENT ON COLUMN sijagakali.deployments.wa_template_bahaya IS 'WhatsApp: template jika water_status=bahaya; kosong di aplikasi boleh jatuh ke wa_template_siaga.';
COMMENT ON COLUMN sijagakali.deployments.contact_petugas IS 'Teks kontak petugas untuk placeholder {kontak_petugas}.';
COMMENT ON COLUMN sijagakali.deployments.contact_bpbd IS 'Nomor/teks BPBD untuk placeholder {no_bpbd}.';
COMMENT ON COLUMN sijagakali.deployments.contact_posko IS 'Nomor/teks posko untuk placeholder {no_posko}.';
