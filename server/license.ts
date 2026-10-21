/**
 * Litsenziya: klinika Palantir Hub'ga ulangan bo'lsa, hub har holat xabariga (heartbeat.ts) litsenziya muddatini va to'xtatilganini
 * qaytaradi; oxirgi tasdiq DATA_DIR/litsenziya.json da. Internet yoki hub bo'lmasa — oxirgi tasdiqdan 7 kun imtiyoz.
 * Hozircha faqat ogohlantiradi: panelda, egasiga Telegram'da (kuniga bir marta) — xizmat to'xtatilmaydi.
 * Hub kodi yo'q (sinov yoki o'z serveri) — tekshirilmaydi.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { iso } from '../src/lib/week';
import { businesses } from './db';
import { env } from './env';
import { notifyOwner } from './inbox/core';
import { licenseStateOf, type LicenseSaved, type LicenseView } from './licenseRules';

type Saved = LicenseSaved & { notified?: string };

const file = () => join(env.dataDir, 'litsenziya.json');

function read(now: Date): Saved {
  try {
    if (existsSync(file())) return JSON.parse(readFileSync(file(), 'utf8')) as Saved;
  } catch { /* buzilgan fayl — yangidan */ }
  const fresh: Saved = { until: null, suspended: false, checkedAt: null, firstSeenAt: now.toISOString() };
  write(fresh);
  return fresh;
}

function write(s: Saved): void {
  try {
    writeFileSync(`${file()}.tmp`, JSON.stringify(s, null, 2));
    renameSync(`${file()}.tmp`, file());
  } catch (e) {
    console.error('[litsenziya] yozilmadi:', (e as Error).message);
  }
}

/** Hub javobidagi litsenziya (heartbeat.ts) — tasdiqlangan payt bilan saqlanadi */
export function saveLicense(l: { until?: unknown; suspended?: unknown }, now = new Date()): void {
  const until = typeof l.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(l.until) ? l.until : null;
  write({ ...read(now), until, suspended: l.suspended === true, checkedAt: now.toISOString() });
}

export const licenseView = (now = new Date()): LicenseView => licenseStateOf(read(now), now, !!env.hub);

/** Muammo bo'lsa — har egasiga kuniga bir marta Telegram'da */
export async function remindLicense(now = new Date()): Promise<void> {
  const v = licenseView(now);
  if (!v.message) return;
  const s = read(now), key = `${iso(now)}:${v.state}`;
  if (s.notified === key) return;
  write({ ...s, notified: key });
  for (const b of businesses.all()) if (b.active && b.ownerChatId) await notifyOwner(b, `⚠️ ${v.message}.`).catch(() => null);
}

export function startLicenseReminder(): () => void {
  const tick = () => { void remindLicense().catch(e => console.error('[litsenziya]', (e as Error).message)); };
  const timer = setInterval(tick, 3_600_000);
  timer.unref();
  return () => clearInterval(timer);
}
