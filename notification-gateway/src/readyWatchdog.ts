/**
 * Pemulihan sesi whatsapp-web.js kadang macet: `authenticated` datang tapi `ready` tidak
 * pernah (upstream wwebjs #5717/#5773, tanpa fix). onStuck dipanggil bila `ready` tidak
 * datang dalam timeoutMs sejak `authenticated`; gateway lalu keluar dan Docker
 * (restart: unless-stopped) menyalakannya lagi. Menunggu scan QR tidak dihitung macet.
 */
export function createReadyWatchdog(onStuck: (why: string) => void, timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return {
    authenticated() {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        onStuck(`ready tidak datang ${Math.round(timeoutMs / 1000)} detik setelah autentikasi`);
      }, timeoutMs);
    },
    ready: stop,
    qr: stop,
  };
}
