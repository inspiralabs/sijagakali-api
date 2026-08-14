-- RPC terbatas: hanya memperbarui kolom CCTV / streaming (bypass RLS via SECURITY DEFINER).
-- Dipanggil dari frontend dengan kunci anon. Pastikan slug + device_id sudah benar di aplikasi.
-- Catatan keamanan: siapa pun yang memegang anon key dapat memanggil RPC ini jika mengetahui pasangan slug/device_id.

CREATE OR REPLACE FUNCTION sijagakali.update_device_cctv_config(
  p_deployment_slug text,
  p_device_id text,
  p_cctv_local_ip text,
  p_stream_playback_url text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = sijagakali, public
AS $$
BEGIN
  UPDATE sijagakali.device_configs
  SET
    cctv_local_ip = NULLIF(BTRIM(COALESCE(p_cctv_local_ip, '')), ''),
    stream_playback_url = NULLIF(BTRIM(COALESCE(p_stream_playback_url, '')), ''),
    updated_at = now()
  WHERE deployment_slug = p_deployment_slug
    AND device_id = p_device_id;
END;
$$;

REVOKE ALL ON FUNCTION sijagakali.update_device_cctv_config(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sijagakali.update_device_cctv_config(text, text, text, text) TO anon, authenticated, service_role;
