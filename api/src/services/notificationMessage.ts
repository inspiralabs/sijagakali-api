/** Build teks preview notifikasi (sama format dengan gateway). */

const STATUS_LABEL: Record<string, string> = {
  normal: 'Siaga 4 — Normal',
  waspada: 'Siaga 3 — Waspada',
  siaga: 'Siaga 2 — Siaga',
  bahaya: 'Siaga 1 — BAHAYA',
};

export function buildTestPreview(opts: {
  locationName: string;
  water_level_cm: number;
  water_status: string;
  template: string | null;
  dashboardUrl: string;
  isTest: boolean;
}): string {
  const { locationName, water_level_cm, water_status, template, dashboardUrl, isTest } = opts;

  const now = new Date();
  const tanggal = now.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Jakarta',
  });
  const pad = (n: number) => String(n).padStart(2, '0');
  const wib = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  const jam = `${pad(wib.getHours())}:${pad(wib.getMinutes())}:${pad(wib.getSeconds())}`;
  const waktu = `${tanggal} ${jam}`;

  const statusLabel = STATUS_LABEL[water_status] ?? water_status.toUpperCase();
  const levelM = (water_level_cm / 100).toFixed(2);

  let text: string;

  if (template) {
    text = template
      .replace(/{lokasi}/g, locationName)
      .replace(/{level_cm}/g, water_level_cm.toFixed(1))
      .replace(/{level_m}/g, levelM)
      .replace(/{status}/g, statusLabel)
      .replace(/{waktu}/g, waktu)
      .replace(/{dashboard_url}/g, dashboardUrl);
  } else {
    const lines = [
      '*SiJagaAir EWS Bojong Kulur*',
      'Laporan Tinggi Muka Air',
      '',
      `Lokasi   : ${locationName}`,
      `Waktu    : ${waktu}`,
      '',
      'Laporan:',
      `Ketinggian : ${levelM} m (${water_level_cm.toFixed(1)} cm)`,
      `Status     : ${statusLabel}`,
      '',
      `Dashboard  : ${dashboardUrl}`,
    ];
    text = lines.join('\n');
  }

  return isTest ? `[TEST]\n${text}` : text;
}
