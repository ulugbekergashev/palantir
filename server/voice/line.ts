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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { connections, type BusinessRow } from '../db';
import { open, seal } from '../secret';

import { LINE_MODES, type LineMode, type LineRouting } from './route';
import { voiceAgentKey } from './serviceEnv';
import { ZADARMA_HOST, ZADARMA_PORT, zadarmaProblem, zadarmaSetup, type ZadarmaKeys } from './zadarma';

export { routeNow, transferNow, type LineMode, type LineRouting } from './route';
export interface LineTrunk { host: string; port: number; login: string; number: string }
/** zadarma — API kalitlari bilan o'zi sozlangan; manual — server/login/parol qo'lda kiritilgan (Uztelecom va boshqalar) */
export type LineProvider = 'zadarma' | 'manual';
export interface LineView {
  trunk: LineTrunk | null;
  provider: LineProvider | null;
  routing: LineRouting;
  /** Administrator telefoni uchun SIP akkaunt (Zoiper): server — shu kompyuterning ichki tarmoqdagi manzili */
  admin: { server: string; login: string; password: string | null };
  /** Asterisk holati: ishlayaptimi, shahar raqami ro'yxatdan o'tganmi, qaysi telefonlar ulangan */
  /** ai — AI ovoz xizmati qo'ng'iroq qabul qilyaptimi (null — tekshirilmadi) */
  status: { asterisk: boolean; trunk: 'none' | 'registered' | 'failed' | 'unknown'; phones: string[]; ai: boolean | null; note: string | null };
}

const KIND = 'sip_line';
const DIR = resolve('tgvoice', 'asterisk');
/** Asterisk shu kompyuterdagi WSL'da (klinika kompyuteri). ASTERISK_WSL=0 — o'chiq (sinov serverlari haqiqiy Asterisk'ka tegmasin) */
const ENABLED = process.platform === 'win32' && process.env.ASTERISK_WSL !== '0';
const WSL_TIMEOUT_MS = 60_000;
export const DEFAULT_ROUTING: LineRouting = { mode: 'ai', ring: 20, days: [1, 2, 3, 4, 5, 6], from: '09:00', to: '20:00' };

interface Secrets { password?: string; admin?: string; zadarma?: ZadarmaKeys }
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

/** AI ovoz xizmati (tgvoice/sip_live.py) shu kompyuterda qo'ng'iroq qabul qilyaptimi — Asterisk unga ulanadigan port ochiqmi */
const AI_PORT = Number(process.env.SIP_BRIDGE_PORT) || 9092;
const aiListening = () => new Promise<boolean>(ok => {
  const s = connect({ host: '127.0.0.1', port: AI_PORT, timeout: 1500 }, () => { s.destroy(); ok(true); });
  s.on('error', () => ok(false));
  s.on('timeout', () => { s.destroy(); ok(false); });
});

export async function lineStatus(): Promise<LineView['status']> {
  if (!ENABLED) return { asterisk: false, trunk: 'unknown', phones: [], ai: null, note: "Telefon liniyasi faqat klinika kompyuterida (Windows + WSL) ishlaydi" };
  const ai = await aiListening();
  try {
    const regs = await asterisk('pjsip show registrations');
    const contacts = await asterisk('pjsip show contacts');
    const trunk = !/shahar/.test(regs) ? 'none' : /Registered/i.test(regs) ? 'registered' : 'failed';
    const phones = [...new Set([...contacts.matchAll(/Contact:\s+(egasi|admin)\//g)].map(m => m[1]))];
    return { asterisk: true, trunk, phones, ai, note: null };
  } catch (e) {
    return { asterisk: false, trunk: 'unknown', phones: [], ai, note: `Asterisk javob bermadi: ${(e as Error).message}` };
  }
}

/** Liniya holatidan egasiga aytiladigan muammo (raqam kiritilgan bo'lsa); hammasi joyida — null */
export function lineProblemOf(s: LineView['status']): string | null {
  if (!s.asterisk) return "telefon xizmati (Asterisk) javob bermayapti — mijozlar qo'ng'iroqlari qabul qilinmayapti. Kompyuterni qayta yoqing";
  if (s.ai === false) return "AI ovoz xizmati ishlamayapti — qo'ng'iroqlarga javob berilmaydi. Kompyuterni qayta yoqing; davom etsa o'rnatuvchiga ayting";
  if (s.trunk === 'failed') return "raqam ulanmadi — internetni tekshiring; davom etsa Sozlamalar → Telefon liniyasi → Qayta ulash";
  if (s.trunk === 'none') return "raqam telefon xizmatiga o'rnatilmagan — Sozlamalar → Telefon liniyasi → Qayta ulash";
  return null;
}

const ZADARMA_CHECK_MS = Number(process.env.ZADARMA_CHECK_MS) || 3_600_000;
const zadarmaSeen = new Map<string, { at: number; problem: string | null }>();

/**
 * Kanallar nazorati uchun (server/monitor.ts): liniya va Zadarma hisobi. Faqat raqam kiritilgan klinika kompyuterida tekshiriladi;
 * Zadarma'ga soatiga bir marta so'raladi (Zadarma javob bermasa — avvalgi holat qoladi, bir lahzalik xato egasini bezovta qilmaydi)
 */
export async function lineChecks(bizId: string, now = Date.now()): Promise<{ key: string; label: string; problem: string | null }[]> {
  const a = connections.get(bizId, KIND)?.account;
  if (!ENABLED || !a?.host) return [];
  // Ovozli agent kaliti yangilangan (yoki o'rnatishda .env da yo'q edi) — Asterisk'ka yetkaziladi
  if (writePalantirConf()) await applyLine().catch(e => console.error('[telefon] kalit Asterisk\'ka yozilmadi:', (e as Error).message));
  const out = [{ key: 'phone_line', label: 'Telefon liniyasi', problem: lineProblemOf(await lineStatus()) }];
  const keys = zadarmaKeysOf(bizId);
  if (a.provider === 'zadarma' && keys && a.number) {
    const seen = zadarmaSeen.get(bizId);
    if (!seen || now - seen.at >= ZADARMA_CHECK_MS) {
      try { zadarmaSeen.set(bizId, { at: now, problem: await zadarmaProblem(keys, a.number, now) }); } catch { /* Zadarma javob bermadi — keyingi soatda */ }
    }
    out.push({ key: 'zadarma', label: 'Zadarma hisobi', problem: zadarmaSeen.get(bizId)?.problem ?? null });
  }
  return out;
}

export async function lineView(biz: BusinessRow, withStatus = true): Promise<LineView> {
  const c = connections.get(biz.id, KIND);
  const a = c?.account ?? {};
  const s = secretsOf(biz.id);
  return {
    trunk: a.host ? { host: a.host, port: Number(a.port) || 5060, login: a.login ?? '', number: a.number ?? '' } : null,
    // sip.zadarma.com — har doim Zadarma, «Boshqa operator» shaklida qo'lda kiritilgan bo'lsa ham (o'sha shakl Uztelecom, Sarkor
    // va boshqalar uchun; aks holda u Zadarma ma'lumoti bilan to'lib ochiladi)
    provider: a.host ? (a.provider === 'zadarma' || a.host.trim().toLowerCase() === ZADARMA_HOST ? 'zadarma' : 'manual') : null,
    routing: lineRouting(biz.id),
    admin: { server: lanIp(), login: 'admin', password: s.admin ?? null },
    status: withStatus ? await lineStatus() : { asterisk: false, trunk: 'unknown', phones: [], ai: null, note: null },
  };
}

/** Asterisk sozlama qatoridagi qiymat: qator uzilishi, izoh va bo'limni buzadigan belgilar o'tmaydi */
const confValue = (v: string) => v.replace(/[\r\n;[\]]/g, '').trim();

function writeTrunkConf(t: LineTrunk, password: string): void {
  if (!ENABLED) return;
  const host = confValue(t.host), port = t.port === 5060 ? '' : `:${t.port}`, user = confValue(t.login), num = confValue(t.number);
  // 5061 — shifrlangan SIP (TLS): provayder oddiy SIP'ni to'sganda ham o'tadi. Aks holda UDP (DNS TCP'ni taklif qilsa ham — TCP'da
  // javob kelmaydi, sip.zadarma.com)
  const proto = t.port === 5061 ? 'tls' : 'udp', uriTail = proto === 'tls' ? ';transport=tls' : '';
  writeFileSync(join(DIR, 'pjsip_shahar.conf'), `; Panel yozgan (Sozlamalar → Telefon liniyasi) — qo'lda o'zgartirmang
[shahar]
type=registration
transport=${proto}
outbound_auth=shahar
server_uri=sip:${host}${port}${uriTail}
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
contact=sip:${host}${port}${uriTail}

[shahar]
type=endpoint
transport=${proto}
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

/**
 * Asterisk «kim javob beradi» deb Palantir'dan so'raydigan manzil va kalit. Kalitni panel o'zi yaratadi (ovoz.env) — .env da bo'lmasa
 * ham Asterisk'ka yetib boradi; aks holda u 401 olib, «avval administrator» rejimini jimgina tashlab, doim AI'ga beradi
 */
function writePalantirConf(): boolean {
  if (!ENABLED) return false;
  const file = join(DIR, 'extensions_palantir.conf');
  const text = `[globals]\nPALANTIR_URL=http://127.0.0.1:${Number(process.env.PORT) || 3200}\nPALANTIR_KEY=${confValue(voiceAgentKey() ?? '')}\n`;
  if (existsSync(file) && readFileSync(file, 'utf8') === text) return false;
  writeFileSync(file, text, { mode: 0o600 });
  return true;
}

/** Fayllar Asterisk'ka o'rnatiladi (qo'ng'iroqlarni uzmasdan qayta yuklanadi) */
export async function applyLine(): Promise<void> {
  if (!ENABLED || !existsSync(join(DIR, 'install.sh'))) throw new Error("Telefon liniyasi faqat klinika kompyuterida (Windows + WSL) sozlanadi");
  writePalantirConf();
  await wsl(['bash', wslPath(join(DIR, 'install.sh')), 'reload']);
}

export function saveTrunk(biz: BusinessRow, t: LineTrunk, password: string | null): void {
  const cur = connections.get(biz.id, KIND);
  const s = secretsOf(biz.id);
  const pass = password ?? s.password;
  if (!pass) throw new Error('Parol kerak');
  // Qo'lda kiritildi — Zadarma kalitlari (bo'lsa) endi bu liniyaga tegishli emas
  const rest: Secrets = { ...s };
  delete rest.zadarma;
  connections.save(biz.id, KIND, seal(JSON.stringify({ ...rest, password: pass })), { host: t.host, port: String(t.port), login: t.login, number: t.number, provider: 'manual' }, cur?.meta ?? {});
  writeTrunkConf(t, pass);
}

/** Zadarma kalitlari (balansni kuzatish uchun ham kerak) */
export const zadarmaKeysOf = (bizId: string): ZadarmaKeys | null => secretsOf(bizId).zadarma ?? null;

/**
 * Zadarma: kalitlar bilan raqam, alohida SIP va yo'naltirish o'zi sozlanadi, keyin Asterisk'ka yoziladi.
 * Avval ochilgan SIP qayta ishlatiladi (qayta bosilsa Zadarma'da SIP'lar ko'payib ketmaydi)
 */
export async function connectZadarma(biz: BusinessRow, keys: ZadarmaKeys, number?: string | null) {
  const cur = connections.get(biz.id, KIND);
  const known = cur?.account?.provider === 'zadarma' ? cur.account.login ?? null : null;
  const z = await zadarmaSetup(keys, { number, knownSip: known });
  const trunk: LineTrunk = { host: ZADARMA_HOST, port: ZADARMA_PORT, login: z.sipId, number: z.number };
  const s = secretsOf(biz.id);
  connections.save(biz.id, KIND, seal(JSON.stringify({ ...s, password: z.password, zadarma: keys })),
    { host: trunk.host, port: String(trunk.port), login: trunk.login, number: trunk.number, provider: 'zadarma' }, cur?.meta ?? {});
  writeTrunkConf(trunk, z.password);
  return z;
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
