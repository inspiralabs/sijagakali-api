import type { WaterStatus } from './types.js';

/** Template WA panjang per status jika DB kosong (preview, test, produksi). */
export const BUILTIN_WA_TEMPLATE_BY_STATUS: Record<WaterStatus, string> = {
  normal: `━━━━━━━━━━━━━━━━━━━━
🌊 *SiJagaKali | Laporan TMA*
📍 Pos Pantau: *{nama_pos}*
🏘️ Wilayah: *{wilayah}*
━━━━━━━━━━━━━━━━━━━━

📏 *Tinggi Muka Air*
  Saat ini : *{level_cm} cm* (~{level_m} m)
  Ambang waspada : {batas_waspada} cm
  Ambang siaga : {batas_siaga} cm

🟢 *Status: NORMAL*
Kondisi aman. Tidak ada ancaman banjir.

🕐 Waktu pencatatan (WIB): {waktu}
🔁 Update berikutnya: ±{interval} menit

📊 *Pantau live:* {dashboard_url}
━━━━━━━━━━━━━━━━━━━━
_Pesan otomatis oleh SiJagaKali_`,

  waspada: `━━━━━━━━━━━━━━━━━━━━
⚠️ *SiJagaKali | PERINGATAN DINI*
📍 Pos Pantau: *{nama_pos}*
🏘️ Wilayah: *{wilayah}*
━━━━━━━━━━━━━━━━━━━━

📏 *Tinggi Muka Air*
  Saat ini : *{level_cm} cm* (~{level_m} m)  ⬆️ naik {selisih} cm
  Ambang waspada : {batas_waspada} cm ✅ Terlampaui
  Ambang siaga : {batas_siaga} cm

🟡 *Status: WASPADA*
Air mulai meningkat. Harap pantau kondisi sekitar
dan waspada terhadap kemungkinan banjir.

🕐 Waktu (WIB): {waktu}
📊 *Pantau live:* {dashboard_url}

📞 Info lebih lanjut: {kontak_petugas}
━━━━━━━━━━━━━━━━━━━━
_Pesan otomatis oleh SiJagaKali_`,

  siaga: `🚨🚨🚨 *PERINGATAN BAHAYA* 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━
🌊 *SiJagaKali | SIAGA BANJIR*
📍 Pos Pantau: *{nama_pos}*
🏘️ Wilayah: *{wilayah}*
━━━━━━━━━━━━━━━━━━━━

📏 *Tinggi Muka Air*
  Saat ini : ⚠️ *{level_cm} cm* (~{level_m} m)
  Ambang siaga : {batas_siaga} cm — 🔴 TERLAMPAUI

🔴 *Status: SIAGA*
Ketinggian air sudah melewati batas siaga.
Warga di bantaran sungai harap segera
bersiap untuk evakuasi.

🕐 Waktu (WIB): {waktu}

🆘 *Hubungi segera:*
  BPBD : {no_bpbd}
  Posko Desa : {no_posko}

📊 *Pantau live:* {dashboard_url}
━━━━━━━━━━━━━━━━━━━━
_Pesan otomatis oleh SiJagaKali_`,

  bahaya: `🚨🚨🚨 *PERINGATAN BAHAYA* 🚨🚨🚨
━━━━━━━━━━━━━━━━━━━━
🌊 *SiJagaKali | BAHAYA BANJIR*
📍 Pos Pantau: *{nama_pos}*
🏘️ Wilayah: *{wilayah}*
━━━━━━━━━━━━━━━━━━━━

📏 *Tinggi Muka Air*
  Saat ini : ⚠️ *{level_cm} cm* (~{level_m} m)
  Ambang bahaya : {batas_bahaya} cm — 🔴 TERLAMPAUI

🔴 *Status: BAHAYA*
Ketinggian air sudah melewati batas bahaya.
Warga di bantaran sungai harap segera
bersiap untuk evakuasi.

🕐 Waktu (WIB): {waktu}

🆘 *Hubungi segera:*
  BPBD : {no_bpbd}
  Posko Desa : {no_posko}

📊 *Pantau live:* {dashboard_url}
━━━━━━━━━━━━━━━━━━━━
_Pesan otomatis oleh SiJagaKali_`,
};
