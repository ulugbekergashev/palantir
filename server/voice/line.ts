/**
 * Telefon liniyasi (Asterisk, WSL'da) — panel sozlamalari: shahar raqami (Uztelecom SIP), kim javob beradi va administrator telefoni.
 *   Shahar raqami: egasi panelga kiritadi → tgvoice/asterisk/pjsip_shahar.conf (git'ga tushmaydi) → install.sh Asterisk'ka o'rnatadi.
 *   Kim javob beradi: Asterisk har qo'ng'iroqda /api/voice/route dan so'raydi (extensions.conf, [kiruvchi]) — «admin:20» (avval administrator
 *   telefoni 20 soniya, ko'tarmasa yoki band bo'lsa — AI) yoki «ai». Shuning uchun ish vaqti o'zgarsa Asterisk qayta yuklanmaydi.
 *   Administrator telefoni: Zoiper'da login «admin», paroli shu yerda yaratiladi (pjsip_admin.conf).
 * Parollar bazada shifrlangan (secret.ts); Asterisk'ning o'zi ochiq matn talab qiladi — fayllar faqat shu kompyuterda.
 */
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { connections, type BusinessRow } from '../db';
import { open, seal } from '../secret';

import { LINE_MODES, type LineMode, type LineRouting } from './route';

export { routeNow, transferNow, type LineMode, type LineRouting } from './route';
export interface LineTrunk { host: string; port: number; login: string; number: string }
export interface LineView {
  trunk: LineTrunk | null;
  routing: LineRouting;
  /** Administrator telefoni uchun SIP akkaunt (Zoiper): server — shu kompyuterning ichki tarmoqdagi manzili */
  admin: { server: string; login: string; password: string | null };
  /** Asterisk holati: ishlayaptimi, shahar raqami ro'yxatdan o'tganmi, qaysi telefonlar ulangan */
  status: { asterisk: boolean; trunk: 'none' | 'registered' | 'failed' | 'unknown'; phones: string[]; note: string | null };
}

const KIND = 'sip_line';
const DIR = resolve('tgvoice', 'asterisk');
/** Asterisk shu kompyuterdagi WSL'da (klinika kompyuteri). ASTERISK_WSL=0 — o'chiq (sinov serverlari haqiqiy Asterisk'ka tegmasin) */
const ENABLED = process.platform === 'win32' && process.env.ASTERISK_WSL !== '0';
const WSL_TIMEOUT_MS = 60_000;
export const DEFAULT_ROUTING: LineRouting = { mode: 'ai', ring: 20, days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '20:00' };

interface Secrets { password?: string; admin?: string }
const secretsOf = (bizId: string): Secrets => {
  const c = connections.get(bizId, KIND);
  if (!c?.secret) return {};
  try { return JSON.parse(open(c.secret)) as Secrets; } catch { return {}; }
};

export function lineRouting(bizId: string): LineRouting {
  const m = connections.get(bizId, KIND)?.meta ?? {};
  return {
    mode: (LINE_MODES as string[]).includes(m.mode ?? '') ? m.mode as LineMode : 'ai',
    ring: Number(m.ring) || DEFAULT_ROUTING.ring,
    days: m.days ? m.days.split(',').map(Number).filter(d => d >= 1 && d <= 7) : DEFAULT_ROUTING.days,
    from: m.from || DEFAULT_ROUTING.from,
    to: m.to || DEFAULT_ROUTING.to,
  };
}

/** Shu kompyuterning ichki tarmoqdagi IPv4 manzili (Zoiper shu manzilga ulanadi) */
function lanIp(): string {
  for (const list of Object.values(networkInterfaces())) {
    for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(n.address)) return n.address;
  }
  return '127.0.0.1';
}

/**
 * Asterisk turgan WSL distributivi (WSL_DISTRO yoki «Palantir»). Dastur avval Cerebro deb atalgan (eski nom): o'sha nomli
 * distributiv bo'lsa — o'sha (install/telefon.ps1 ham ikkinchisini o'rnatmaydi)
 */
let distro: Promise<string> | null = null;
const wslDistro = (): Promise<string> => distro ??= process.env.WSL_DISTRO ? Promise.resolve(process.env.WSL_DISTRO) : new Promise(ok => {
  execFile('wsl', ['-l', '-q'], { timeout: WSL_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' }, (_e, out) => {
    const have = String(out ?? '').replace(/\0/g, '').split(/\r?\n/).map(s => s.trim());
    ok(!have.includes('Palantir') && have.includes('Cerebro') ? 'Cerebro' : 'Palantir'); // eski nom
  });
});

/** WSL ichida buyruq (Asterisk). WSL yoki distributiv yo'q bo'lsa — xato */
async function wsl(args: string[]): Promise<string> {
  const name = await wslDistro();
  return new Promise((ok, fail) => {
    execFile('wsl', ['-d', name, '-u', 'root', '--', ...args], { timeout: WSL_TIMEOUT_MS, windowsHide: true, encoding: 'utf8' }, (e, out, err) => {
      if (e) fail(new Error((String(err || '').trim().split(/\r?\n/).at(-1) || e.message).slice(0, 200)));
      else ok(String(out).replace(/\0/g, ''));
    });
  });
}
const asterisk = (cmd: string) => wsl(['asterisk', '-rx', cmd]);
/** D:\Projects\palantir → /mnt/d/Projects/palantir */
const wslPath = (p: string) => p.replace(/^([A-Za-z]):/, (_, d: string) => `/mnt/${d.toLowerCase()}`).replace(/\\/g, '/');

export async function lineStatus(): Promise<LineView['status']> {
  if (!ENABLED) return { asterisk: false, trunk: 'unknown', phones: [], note: "Telefon liniyasi faqat klinika kompyuterida (Windows + WSL) ishlaydi" };
  try {
    const regs = await asterisk('pjsip show registrations');
    const contacts = await asterisk('pjsip show contacts');
    const trunk = !/shahar/.test(regs) ? 'none' : /Registered/i.test(regs) ? 'registered' : 'failed';
    const phones = [...new Set([...contacts.matchAll(/Contact:\s+(egasi|admin)\//g)].map(m => m[1]))];
    return { asterisk: true, trunk, phones, note: null };
  } catch (e) {
    return { asterisk: false, trunk: 'unknown', phones: [], note: `Asterisk javob bermadi: ${(e as Error).message}` };
  }
}

export async function lineView(biz: BusinessRow, withStatus = true): Promise<LineView> {
  const c = connections.get(biz.id, KIND);
  const a = c?.account ?? {};
  const s = secretsOf(biz.id);
  return {
    trunk: a.host ? { host: a.host, port: Number(a.port) || 5060, login: a.login ?? '', number: a.number ?? '' } : null,
    routing: lineRouting(biz.id),
    admin: { server: lanIp(), login: 'admin', password: s.admin ?? null },
    status: withStatus ? await lineStatus() : { asterisk: false, trunk: 'unknown', phones: [], note: null },
  };
}

/** Asterisk sozlama qatoridagi qiymat: qator uzilishi, izoh va bo'limni buzadigan belgilar o'tmaydi */
const confValue = (v: string) => v.replace(/[\r\n;[\]]/g, '').trim();

function writeTrunkConf(t: LineTrunk, password: string): void {
  if (!ENABLED) return;
  const host = confValue(t.host), port = t.port === 5060 ? '' : `:${t.port}`, user = confValue(t.login), num = confValue(t.number);
  writeFileSync(join(DIR, 'pjsip_shahar.conf'), `; Panel yozgan (Sozlamalar → Telefon liniyasi) — qo'lda o'zgartirmang
[shahar]
type=registration
outbound_auth=shahar
server_uri=sip:${host}${port}
client_uri=sip:${user}@${host}${port}
contact_user=${num || user}
retry_interval=60

[shahar]
type=auth
auth_type=userpass
username=${user}
password=${confValue(password)}

[shahar]
type=aor
contact=sip:${host}${port}

[shahar]
type=endpoint
context=shahar
disallow=all
allow=alaw,ulaw
outbound_auth=shahar
aors=shahar
from_user=${user}
from_domain=${host}
direct_media=no
rtp_symmetric=yes
force_rport=yes

[shahar]
type=identify
endpoint=shahar
match=${host}
`, { mode: 0o600 });
}

const writeAdminConf = (password: string) => ENABLED &&
  writeFileSync(join(DIR, 'pjsip_admin.conf'), `[admin]\ntype=auth\nauth_type=userpass\nusername=admin\npassword=${confValue(password)}\n`, { mode: 0o600 });

/** Fayllar Asterisk'ka o'rnatiladi (qo'ng'iroqlarni uzmasdan qayta yuklanadi) */
export async function applyLine(): Promise<void> {
  if (!ENABLED || !existsSync(join(DIR, 'install.sh'))) throw new Error("Telefon liniyasi faqat klinika kompyuterida (Windows + WSL) sozlanadi");
  await wsl(['bash', wslPath(join(DIR, 'install.sh')), 'reload']);
}

export function saveTrunk(biz: BusinessRow, t: LineTrunk, password: string | null): void {
  const cur = connections.get(biz.id, KIND);
  const s = secretsOf(biz.id);
  const pass = password ?? s.password;
  if (!pass) throw new Error('Parol kerak');
  connections.save(biz.id, KIND, seal(JSON.stringify({ ...s, password: pass })), { host: t.host, port: String(t.port), login: t.login, number: t.number }, cur?.meta ?? {});
  writeTrunkConf(t, pass);
}

export function saveRouting(biz: BusinessRow, r: LineRouting): void {
  const meta = { mode: r.mode, ring: String(r.ring), days: r.days.join(','), from: r.from, to: r.to };
  const cur = connections.get(biz.id, KIND);
  if (cur) connections.setMeta(biz.id, KIND, { ...cur.meta, ...meta });
  else connections.save(biz.id, KIND, seal('{}'), {}, meta);
}

/** Administrator telefoni uchun yangi parol (eskisi bilan ulangan telefon uziladi) */
export function newAdminPassword(biz: BusinessRow): string {
  const password = randomBytes(9).toString('base64url');
  const cur = connections.get(biz.id, KIND);
  const s = secretsOf(biz.id);
  connections.save(biz.id, KIND, seal(JSON.stringify({ ...s, admin: password })), cur?.account ?? {}, cur?.meta ?? {});
  writeAdminConf(password);
  return password;
}
