/**
 * MicroSIP yozib olgan suhbat faylini qo'ng'iroqqa topish. MicroSIP fayl nomini o'zi tanlaydi (versiyaga qarab sana, vaqt, raqam),
 * shuning uchun nomga emas, VAQTGA qaraladi: fayl suhbat paytida yaratilgan va oxirgi marta suhbat tugashi atrofida yozilgan.
 * Nomida raqam bo'lsa — shu raqamlisi afzal (ikki qo'ng'iroq bir paytda bo'lsa ham adashmasin).
 */
import fs from 'node:fs';
import path from 'node:path';

export const AUDIO_EXT = /\.(wav|mp3|ogg|opus)$/i;
/** Soat farqi va fayl yopilishi kechikishi uchun zaxira */
const SLACK_MS = 15_000;
/** Bundan qisqa fayl — bo'sh yozuv (sarlavhasi bor, ovoz yo'q) */
const MIN_BYTES = 2_000;

export interface FoundRecording { file: string; ext: string; size: number }

/** answeredAt..endedAt suhbatiga mos fayl (topilmasa — null). digits — raqamning oxirgi 9 xonasi (nomda bo'lsa afzal) */
export function findRecording(dir: string, call: { answeredAt: number; endedAt: number }, digits: string | null, taken: Set<string> = new Set()): FoundRecording | null {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const hits: { file: string; ext: string; size: number; score: number }[] = [];
  for (const name of names) {
    if (!AUDIO_EXT.test(name) || taken.has(name)) continue;
    const file = path.join(dir, name);
    let st: fs.Stats;
    try { st = fs.statSync(file); } catch { continue; }
    if (!st.isFile() || st.size < MIN_BYTES) continue;
    // Yaratilgan payt (Windows'da birthtime ishonchli) suhbat ichida, oxirgi yozilgani — tugash atrofida
    const born = st.birthtimeMs || st.ctimeMs;
    if (born < call.answeredAt - SLACK_MS || born > call.endedAt + SLACK_MS) continue;
    if (st.mtimeMs < call.answeredAt || st.mtimeMs > call.endedAt + SLACK_MS * 2) continue;
    const byName = digits && name.replace(/\D/g, '').includes(digits) ? 0 : 1;
    hits.push({ file, ext: path.extname(name).slice(1).toLowerCase(), size: st.size, score: byName * 1e9 + Math.abs(st.mtimeMs - call.endedAt) });
  }
  hits.sort((a, b) => a.score - b.score);
  return hits[0] ? { file: hits[0].file, ext: hits[0].ext, size: hits[0].size } : null;
}

/** Faylni Palantir'ning yozuvlar papkasiga ko'chiradi (MicroSIP papkasi bo'shab turadi). Qaytadi — yangi nom */
export function moveRecording(found: FoundRecording, targetDir: string, callId: string): string {
  fs.mkdirSync(targetDir, { recursive: true });
  const name = `${callId}.${found.ext}`;
  const target = path.join(targetDir, name);
  try {
    fs.renameSync(found.file, target);
  } catch {
    // Boshqa diskda — nusxa olib, asli o'chiriladi
    fs.copyFileSync(found.file, target);
    try { fs.unlinkSync(found.file); } catch { /* MicroSIP hali ushlab turgan bo'lsa — keyin tozalanadi */ }
  }
  return name;
}

export const MIME: Record<string, string> = { wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg' };
