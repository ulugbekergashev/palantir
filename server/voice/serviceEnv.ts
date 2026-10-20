/**
 * Ovoz xizmati (tgvoice, Python — telefon liniyasi, panel ovozi, «Quloq») uchun sozlamalar fayli: DATA_DIR/ovoz.env.
 * Panelda kiritilgan kalitlar bazada turadi — Python ularni shu fayldan oladi; klinika kompyuterida (bitta biznes) ovozli agent
 * kaliti ham shu yerda o'zi yaratiladi, egasi hech narsa ko'chirmaydi. .env dagi qiymat ustun: Python avval shu faylni, keyin .env ni o'qiydi.
 * Fayl faqat mazmuni o'zgarsa qayta yoziladi (Python o'zgarganini sezib, yangi kalitni oladi).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { businesses } from '../db';
import { onKeyChange } from '../keys';
import { newVoiceKey, voiceKeyOwner } from './agentKey';

const FILE = join(resolve(process.env.DATA_DIR || 'data'), 'ovoz.env');
const CHECK_MS = Number(process.env.VOICE_ENV_MS) || 60_000;

const read = (): Record<string, string> => {
  if (!existsSync(FILE)) return {};
  return Object.fromEntries(readFileSync(FILE, 'utf8').split(/\r?\n/).filter(l => l.includes('=') && !l.startsWith('#')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
};

const onlyBusiness = (): string | null => {
  const active = businesses.all().filter(b => b.active);
  return active.length === 1 ? active[0].id : null;
};

/** Ovozli agent kaliti: .env da berilgan bo'lsa — o'sha (faylga yozilmaydi); bo'lmasa — fayldagisi yoki (bitta biznes bo'lsa) yangisi */
function agentKey(had: string | undefined): string | null {
  if (process.env.VOICE_AGENT_KEY) return null;
  if (had && voiceKeyOwner(had)) return had;
  const only = onlyBusiness();
  return only ? newVoiceKey(only) : null;
}

/** fresh — panelda hozirgina yaratilgan kalit (adoptVoiceKey): fayldagisi o'rniga shu yoziladi */
export function syncVoiceEnv(fresh?: string): void {
  const had = read();
  const key = agentKey(fresh ?? had.VOICE_AGENT_KEY);
  const lines = [
    '# Cerebro yozadi (server/voice/serviceEnv.ts) — qo\'lda o\'zgartirmang; .env dagi qiymat ustun',
    ...(process.env.GEMINI_API_KEY ? [`GEMINI_API_KEY=${process.env.GEMINI_API_KEY}`] : []),
    ...(key ? [`VOICE_AGENT_KEY=${key}`] : []),
  ];
  const text = `${lines.join('\n')}\n`;
  if (existsSync(FILE) && readFileSync(FILE, 'utf8') === text) return;
  try { writeFileSync(FILE, text, { mode: 0o600 }); } catch (e) { console.error('[ovoz] ovoz.env yozilmadi:', (e as Error).message); }
}

/**
 * Panelda yangi kalit yaratildi: biznesga bitta kalit, eskisi yaroqsiz bo'ldi. Klinika kompyuterida (bitta biznes) yangisi ovoz xizmatiga
 * ham yoziladi — aks holda keyingi tekshiruv fayldagi eski kalitni yaroqsiz ko'rib yana yangisini yaratadi va panelda berilgani ishlamay qoladi
 */
export function adoptVoiceKey(bizId: string, key: string): void {
  if (onlyBusiness() === bizId) syncVoiceEnv(key);
}

export function startVoiceEnv(): () => void {
  syncVoiceEnv();
  onKeyChange(name => { if (name === 'GEMINI_API_KEY') syncVoiceEnv(); });
  // Biznes ulash ustasida keyinroq yaratiladi — kalit o'shanda paydo bo'ladi
  const t = setInterval(() => syncVoiceEnv(), CHECK_MS);
  t.unref();
  return () => clearInterval(t);
}
