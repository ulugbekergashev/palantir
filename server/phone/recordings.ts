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

/** Yozuv fayli haqida: nomi, yaratilgan va oxirgi yozilgan payti (ms), hajmi */
export interface RecordingFile { name: string; born: number; mtime: number; size: number }

/**
 * Sof tanlov: answeredAt..endedAt suhbatiga mos fayl. Yaratilgan payt suhbat ichida, oxirgi yozilgani — tugash atrofida;
 * nomida raqam bo'lsa — shu raqamlisi afzal. Fayllar shu kompyuterdan ham, boshqa kompyuterdan (stansiya yuborgan, vaqtlari bilan) ham
 */
export function pickRecording(files: RecordingFile[], call: { answeredAt: number; endedAt: number }, digits: string | null, taken: Set<string> = new Set()): RecordingFile | null {
  const hits: { f: RecordingFile; score: number }[] = [];
  for (const f of files) {
    if (!AUDIO_EXT.test(f.name) || taken.has(f.name) || f.size < MIN_BYTES) continue;
    if (f.born < call.answeredAt - SLACK_MS || f.born > call.endedAt + SLACK_MS) continue;
    if (f.mtime < call.answeredAt || f.mtime > call.endedAt + SLACK_MS * 2) continue;
    const byName = digits && f.name.replace(/\D/g, '').includes(digits) ? 0 : 1;
    hits.push({ f, score: byName * 1e9 + Math.abs(f.mtime - call.endedAt) });
  }
  hits.sort((a, b) => a.score - b.score);
  return hits[0]?.f ?? null;
}

/** answeredAt..endedAt suhbatiga mos fayl shu papkadan (topilmasa — null). digits — raqamning oxirgi 9 xonasi (nomda bo'lsa afzal) */
export function findRecording(dir: string, call: { answeredAt: number; endedAt: number }, digits: string | null, taken: Set<string> = new Set()): FoundRecording | null {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return null; }
  const files: RecordingFile[] = [];
  for (const name of names) {
    if (!AUDIO_EXT.test(name)) continue;
    try {
      const st = fs.statSync(path.join(dir, name));
      // Yaratilgan payt (Windows'da birthtime ishonchli)
      if (st.isFile()) files.push({ name, born: st.birthtimeMs || st.ctimeMs, mtime: st.mtimeMs, size: st.size });
    } catch { /* o'chib ulgurgan */ }
  }
  const hit = pickRecording(files, call, digits, taken);
  return hit ? { file: path.join(dir, hit.name), ext: path.extname(hit.name).slice(1).toLowerCase(), size: hit.size } : null;
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
