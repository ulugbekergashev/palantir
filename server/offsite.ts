/**
 * Tashqi zaxira: kunlik zaxira (backup.ts — baza, «ikkinchi miya», maxfiy kalit) sotuvchining ochiq kaliti bilan shifrlanib
 * Cerebro Hub'ga yuboriladi (hub kodi bo'lsa). Kompyuter yoki disk buzilsa ham ma'lumot yo'qolmaydi; hub uni o'qiy olmaydi.
 * Natija DATA_DIR/zaxira-tashqi.json da — hub holatida ko'rinadi. Yuborilmasa — ertaga keyingisi yuboriladi.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { zipSync } from 'fflate';
import { env } from './env';
import { seal } from './offsiteCrypto';

/** Sotuvchining zaxira kaliti (ochiq qismi; maxfiy qismi sotuvchida). BACKUP_PUBLIC_KEY — o'z yig'ilmalari va sinov uchun */
const PUBLIC_KEY = process.env.BACKUP_PUBLIC_KEY || `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VuAyEAuwNkQCtAKirPh/J/Bmz/RM7Swty4PQqPCuU/80e+Ixk=
-----END PUBLIC KEY-----
`;
const RESULT = () => join(env.dataDir, 'zaxira-tashqi.json');

function files(dir: string, root = dir): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const name of readdirSync(dir)) {
    const path = join(dir, name), st = lstatSync(path);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) Object.assign(out, files(path, root));
    else out[relative(root, path).split(sep).join('/')] = readFileSync(path);
  }
  return out;
}

export function lastOffsite(): unknown {
  try { return JSON.parse(readFileSync(RESULT(), 'utf8')); } catch { return null; }
}

/** day — zaxira papkasi nomi (YYYY-MM-DD). Qaytaradi: hub qabul qildimi (hub kodi yo'q bo'lsa — true: yuboradigan joy yo'q) */
export async function sendOffsite(dir: string, day: string): Promise<boolean> {
  const hub = env.hub;
  if (!hub || !existsSync(dir)) return true;
  let result: Record<string, unknown>;
  try {
    const blob = seal(PUBLIC_KEY, Buffer.from(zipSync(files(dir), { level: 6 })));
    const r = await fetch(`${hub.url}/api/backup?day=${day}`, {
      method: 'POST', headers: { authorization: `Bearer ${hub.key}`, 'content-type': 'application/octet-stream' }, body: new Uint8Array(blob), signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!r.ok) throw new Error(`hub ${r.status}: ${String(((await r.json().catch(() => ({}))) as { error?: string }).error ?? '')}`);
    result = { day, ok: true, size: blob.length };
    console.log(`[zaxira] tashqi nusxa yuborildi: ${day}, ${(blob.length / 1_048_576).toFixed(1)} MB (shifrlangan)`);
  } catch (e) {
    result = { day, ok: false, error: (e as Error).message.slice(0, 300) };
    console.error('[zaxira] tashqi nusxa yuborilmadi:', (e as Error).message);
  }
  try { writeFileSync(RESULT(), JSON.stringify({ ...result, at: new Date().toISOString() })); } catch { /* natija yozilmasa ham */ }
  return result.ok === true;
}
