/**
 * Diagnostika: sotuvchi masofadan yordam berishi uchun bitta matn — nashr, baza nashri, kompyuter, diskdagi joy, kanallardagi
 * muammolar, oxirgi yangilash va tashqi zaxira natijasi, sozlamalar (kalitlarsiz) va jurnallarning oxiri (server, nazoratchi,
 * yangilovchi, telefon liniyasi). .env o'qilmaydi; jurnal qatorlari kalitga o'xshagan narsadan qayta tozalanadi.
 * Yuborish: hub kodi bo'lsa — hubga (sotuvchi /admin/diag dan oladi); bo'lmasa — fayl bo'lib (panel yoki Telegram'da egasiga).
 */
import { existsSync, readFileSync } from 'node:fs';
import { arch, platform, release, totalmem, freemem, uptime } from 'node:os';
import { join } from 'node:path';
import { iso } from '../src/lib/week';
import { env, voiceEnabled } from './env';
import { heartbeatStatus } from './heartbeat';
import { logDir, scrub } from './log';

const tail = (file: string, lines: number): string => {
  if (!existsSync(file)) return '(yo\'q)';
  const all = readFileSync(file, 'utf8').split('\n');
  return all.slice(-lines).map(scrub).join('\n');
};

export function diagnostics(now = new Date()): { name: string; text: string } {
  const today = iso(now), yesterday = iso(new Date(now.getTime() - 86_400_000));
  const status = heartbeatStatus();
  const settings = {
    port: env.port, listenHost: env.listenHost, dataDir: env.dataDir, backupDir: env.backupDir, backupKeep: env.backupKeep,
    aiModel: env.aiModel, ai: env.aiEnabled, voice: voiceEnabled(), bot: !!env.botToken, hub: env.hub ? new URL(env.hub.url).host : null,
    tgPersonal: env.tgPersonal, igViaBrowser: env.igViaBrowser, tgCall: env.tgCall, recordingsKeepDays: env.recordingsKeepDays,
    updateAuto: process.env.UPDATE_AUTO !== '0',
  };
  const mb = (n: number) => `${Math.round(n / 1_048_576)} MB`;
  const text = [
    `Cerebro diagnostika — ${now.toISOString()}`,
    '',
    '## Holat',
    JSON.stringify(status, null, 2),
    '',
    '## Kompyuter',
    `Node ${process.version} · ${platform()} ${release()} ${arch()} · xotira ${mb(freemem())} bo'sh / ${mb(totalmem())} · yoniq ${Math.round(uptime() / 3600)} soat · server ${Math.round(process.uptime() / 60)} daqiqa`,
    '',
    '## Sozlamalar (kalitlarsiz)',
    JSON.stringify(settings, null, 2),
    '',
    `## Server jurnali — ${yesterday} (oxiri)`,
    tail(join(logDir, `${yesterday}.log`), 200),
    '',
    `## Server jurnali — ${today} (oxiri)`,
    tail(join(logDir, `${today}.log`), 400),
    '',
    '## Nazoratchi (supervisor.log)',
    tail(join(logDir, 'supervisor.log'), 150),
    '',
    '## Yangilovchi (yangilash.log)',
    tail(join(logDir, 'yangilash.log'), 150),
    '',
    '## Telefon liniyasi (telefon.log)',
    tail(join(logDir, 'telefon.log'), 150),
    '',
  ].join('\n');
  return { name: `diagnostika-${today}-${now.toTimeString().slice(0, 8).replace(/:/g, '')}.txt`, text };
}

/** Hub kodi bo'lsa — hubga. Qaytaradi: hubdagi fayl nomi; hub yo'q bo'lsa — null (chaqiruvchi faylni o'zi beradi) */
export async function sendDiagnostics(): Promise<string | null> {
  const hub = env.hub;
  if (!hub) return null;
  const { text } = diagnostics();
  const r = await fetch(`${hub.url}/api/diag`, {
    method: 'POST', headers: { authorization: `Bearer ${hub.key}`, 'content-type': 'text/plain; charset=utf-8' }, body: text, signal: AbortSignal.timeout(60_000),
  });
  const j = await r.json().catch(() => ({})) as { file?: string; error?: string };
  if (!r.ok || !j.file) throw new Error(`Hub diagnostikani qabul qilmadi: ${j.error ?? r.status}`);
  return j.file;
}
