/**
 * Telefon liniyasisiz qo'ng'iroq: Telegram orqali AI (tgvoice/call_live.py — Gemini Live, alohida Telegram akkaunt).
 * Eslatma vaqtida egasiga qo'ng'iroq qilib eslatmani o'zbekcha aytadi va javobini bajaradi (bajarildi, surish).
 * Akkaunt bitta — bir vaqtda bitta qo'ng'iroq: qolganlari navbat kutadi.
 * Skript chiqish kodi: 0 — gaplashildi, 2 — ko'tarmadi, rad etdi yoki band, boshqasi — xato.
 * Skriptga biznesning qisqa muddatli kaliti beriladi: u boshqa biznesning vazifa va bilimiga tega olmaydi.
 */
import { spawn } from 'node:child_process';
import { issueToken } from './auth';
import { businesses } from './db';
import { env } from './env';

export const tgCallEnabled = (): boolean => env.tgCall && !!env.tgCallPython && !!env.tgCallScript;

export type TgCallResult = 'answered' | 'missed' | 'failed';

/** Kalit qo'ng'iroq davomida yetadigan muddatga (kunlarda) */
const TOKEN_DAYS = 1;
let line: Promise<unknown> = Promise.resolve();

/** Navbat bilan qo'ng'iroq: to — egasining Telegram id'si, taskId — eslatiladigan vazifa */
export function tgCall(bizId: string, to: string, taskId: string): Promise<TgCallResult> {
  const run = () => new Promise<TgCallResult>(done => {
    const proc = spawn(env.tgCallPython, [env.tgCallScript, to, '--remind', taskId], {
      env: { ...process.env, CEREBRO_URL: `http://127.0.0.1:${env.port}`, CEREBRO_TOKEN: issueToken(bizId, 'business', TOKEN_DAYS, businesses.byId(bizId)?.tokenVer ?? 0) },
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
    });
    let err = '';
    proc.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-600); });
    const timer = setTimeout(() => proc.kill(), env.tgCallLimitMs);
    proc.on('error', e => {
      clearTimeout(timer);
      console.error("[tg qo'ng'iroq]", e.message);
      done('failed');
    });
    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0 && code !== 2) console.error(`[tg qo'ng'iroq] chiqish kodi ${code}: ${err.trim().split('\n').slice(-2).join(' | ').slice(0, 300)}`);
      done(code === 0 ? 'answered' : code === 2 ? 'missed' : 'failed');
    });
  });
  const next = line.then(run, run);
  line = next.catch(() => undefined);
  return next;
}
