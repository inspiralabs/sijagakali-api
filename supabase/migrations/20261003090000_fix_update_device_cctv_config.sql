-- Perbaiki RPC update_device_cctv_config:
-- 1. Badan fungsi masih menulis `sijagaair.device_configs`. Rename schema (20260813103326) hanya
--    memperbarui search_path, bukan teks plpgsql → error 42P01 saat admin menyimpan pengaturan CCTV.
--    Nama tabel kini tanpa prefix schema (ikut search_path), aman bila schema di-rename lagi.
-- 2. Fungsi SECURITY DEFINER ini bisa dipanggil role anon (anon key publik dashboard) → siapa pun
--    bisa mengubah IP kamera / URL live. Hanya admin yang login (authenticated) yang boleh.
CREATE OR REPLACE FUNCTION sijagakali.update_device_cctv_config(
  p_deployment_slug text,
  p_device_id text,
  p_cctv_local_ip text,
  p_stream_playback_url text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sijagakali, public
AS $function$
BEGIN
  UPDATE device_configs
  SET
    cctv_local_ip = NULLIF(BTRIM(COALESCE(p_cctv_local_ip, '')), ''),
    stream_playback_url = NULLIF(BTRIM(COALESCE(p_stream_playback_url, '')), ''),
    updated_at = now()
  WHERE deployment_slug = p_deployment_slug
    AND device_id = p_device_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION sijagakali.update_device_cctv_config(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION sijagakali.update_device_cctv_config(text, text, text, text) TO authenticated, service_role;
