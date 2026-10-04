type MediaProcessor = { processMediaData: (...args: any[]) => Promise<Record<string, unknown>> } & Record<string, unknown>;

/**
 * ponytail: kirim media gagal "Data passed to getter must include an id property (it's how
 * we memoize) but got undefined" — whatsapp-web.js@1.34.7 menyebar hasil processMediaData()
 * ke pesan keluar, dan __x_id model MediaData menimpa id pesan (wwebjs issue #201922).
 * Fix upstream (PR #201923, `delete message.__x_id`) sudah di main tapi belum dirilis.
 * Dijalankan DI HALAMAN WA lewat pupPage.evaluate → harus mandiri (tanpa import/closure).
 * Upgrade path: hapus setelah wwebjs merilis versi yang memuat PR #201923.
 */
export function patchMediaModelId(wwebjs?: MediaProcessor): void {
  const target = wwebjs ?? (window as unknown as { WWebJS: MediaProcessor }).WWebJS;
  if (target.__sjkMediaIdPatched) return;
  const original = target.processMediaData;
  target.processMediaData = async (...args: unknown[]) => {
    // Salinan polos tanpa __x_id (setara spread di sendMessage); delete pada model WA bisa gagal diam-diam.
    const { __x_id: _dropped, ...rest } = await original(...args);
    return rest;
  };
  target.__sjkMediaIdPatched = true;
}
