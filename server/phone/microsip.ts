/**
 * MicroSIP (kompyuterdagi softfon, istalgan SIP operator bilan: UTEL, Uztelecom, Sipuni…) bilan bog'lanish.
 * DentaCRM'dagi (dentalocal/electron/microsipCore.ts) jonli sinalgan ulanishdan ko'chirilgan; qo'shimchasi — suhbatni yozib olish.
 *
 *   1. Palantir'dan qo'ng'iroq:  microsip.exe <raqam>  (ishlab turgan MicroSIP raqamni teradi).
 *   2. MicroSIP → Palantir:      microsip.ini [Settings] cmdIncomingCall / cmdCallAnswer / cmdCallStart / cmdCallEnd / cmdOutgoingCall —
 *      MicroSIP shu FAYLNI ishga tushiradi, raqam parametr bo'lib keladi. U yerda kichik yordamchi (cerebro-call.exe nusxalari)
 *      turadi: hodisani «spool» papkasiga fayl qilib yozadi, Palantir o'qib oladi.
 *   3. Yozuv: autoRecording=1, recordingPath — yordamchi papkasidagi «rec», recordingFormat — mp3 (lame_enc.dll bo'lsa) yoki wav.
 *
 * Muhim (MicroSIP manba kodidan va 3.22.18 bilan jonli sinovdan, 2026-10-10):
 *   - MicroSIP sozlamalarni xotirada saqlaydi va yopilayotganda ini'ga QAYTA YOZADI: ini faqat MicroSIP yopiq paytda o'zgartiriladi
 *     (yopamiz → yozamiz → qayta ochamiz). Ishlab turganida ini'ga tegilmaydi.
 *   - Ko'chma nusxa ini'ni joriy papkadan qidiradi — MicroSIP har doim o'z papkasida (cwd) ishga tushiriladi.
 *   - Yordamchi yo'lida BO'SH JOY bo'lsa MicroSIP 3.22 uni ishga tushirmaydi — yordamchi %ProgramData% ichidagi o'z papkamizda turadi.
 *   - %ProgramData% ga boshqa foydalanuvchilar ham yoza oladi: papka har ulanishda tasodifiy nom bilan O'ZIMIZ yaratiladi va
 *     ruxsatlari yopiladi (secureDir) — begona odam u yerga o'z faylini qo'ya olmaydi.
 */
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const HOOK_KEYS = ['cmdIncomingCall', 'cmdCallAnswer', 'cmdCallStart', 'cmdCallEnd', 'cmdOutgoingCall'] as const;
export type HookKey = typeof HOOK_KEYS[number];
/** Yozib olish sozlamalari: ulanganda yoqiladi, uzilganda oldingi qiymati qaytariladi */
export const RECORD_KEYS = ['autoRecording', 'recordingPath', 'recordingFormat'] as const;
export type RecordKey = typeof RECORD_KEYS[number];
type SettingKey = HookKey | RecordKey;
const SETTING_KEYS: SettingKey[] = [...HOOK_KEYS, ...RECORD_KEYS];
export type HookValues = Record<HookKey, string>;

/** «Ulangan» deyish uchun shart: cmdOutgoingCall faqat yangi versiyalarda bor (eskisi uni yopilganda ini'dan tushiradi) */
export const REQUIRED_HOOK_KEYS: HookKey[] = ['cmdIncomingCall', 'cmdCallAnswer', 'cmdCallStart', 'cmdCallEnd'];
export type MicrosipEventName = 'incoming' | 'answer' | 'start' | 'end' | 'outgoing';
export const HOOK_FILES: Record<HookKey, string> = {
  cmdIncomingCall: 'ms-incoming.exe', cmdCallAnswer: 'ms-answer.exe', cmdCallStart: 'ms-start.exe', cmdCallEnd: 'ms-end.exe', cmdOutgoingCall: 'ms-outgoing.exe',
};

const EVENT_NAMES: MicrosipEventName[] = ['incoming', 'answer', 'start', 'end', 'outgoing'];
const SETTINGS_SECTION = 'settings';
const SPOOL_DIR_NAME = 'spool';
export const RECORD_DIR_NAME = 'rec';
/** Yordamchi yozadigan fayl nomi: vaqt (17 raqam) + 8 ta o'n oltilik belgi */
const SPOOL_FILE = /^\d{17}-[0-9a-f]{8}\.evt$/;
const SPOOL_MAX_BYTES = 512;
/** Palantir yopiq paytda yig'ilib qolgan hodisalar shundan eski bo'lsa tashlab yuboriladi */
const SPOOL_MAX_AGE_MS = 14 * 86_400_000;
const SPOOL_MAX_FILES = 500;
const SPOOL_POLL_MS = 3000;
const SPOOL_STALE_TMP_MS = 60_000;
const EXIT_WAIT_MS = 10_000;
const EXIT_POLL_MS = 250;
const STATE_FILE = 'microsip.json';
const INI_BACKUP_SUFFIX = '.cerebro-backup';
const HOOK_DIR_PREFIX = 'Cerebro-ms-';
const HOOK_DIR_ATTEMPTS = 5;
/** Bo'sh joysiz, faqat lotin harflari va belgilar — MicroSIP yordamchini shunday yo'ldangina ishga tushiradi */
const SAFE_PATH = /^[\x21-\x7E]+$/;

// ─── ini: kodlash, o'qish va o'zgartirish ────────────────────────────────────

export interface IniText {
  text: string;
  /** Windows ini'ni faqat FF FE belgisi bo'lsa Unicode deb o'qiydi, aks holda — ANSI */
  encoding: 'utf16le' | 'latin1';
}

export function decodeIni(buf: Buffer): IniText {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le'), encoding: 'utf16le' };
  // ANSI baytlari latin1 orqali o'zgarishsiz o'qilib-yoziladi (biz qo'shadigan matn — faqat ASCII)
  return { text: buf.toString('latin1'), encoding: 'latin1' };
}

export function encodeIni(ini: IniText): Buffer {
  return ini.encoding === 'utf16le' ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(ini.text, 'utf16le')]) : Buffer.from(ini.text, 'latin1');
}

const sectionName = (line: string): string | null => {
  const m = /^\s*\[([^\]]*)\]\s*$/.exec(line);
  return m ? m[1].trim().toLowerCase() : null;
};
const keyOf = (line: string): string | null => {
  const m = /^\s*([^=;[\s][^=]*?)\s*=/.exec(line);
  return m ? m[1].toLowerCase() : null;
};
/** MicroSIP 3.22 qiymatlarni qo'shtirnoq ichida yozadi (`cmdCallEnd=""`), eskilari — qo'shtirnoqsiz */
const unquote = (value: string): string => {
  const v = value.trim();
  return v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0] ? v.slice(1, -1) : v;
};
const iniLine = (key: string, value: string): string => `${key}="${value}"`;

/** [Settings] bo'limidagi qiymatlar (yo'q bo'lsa — bo'sh satr). Kalit takrorlansa Windows birinchisini o'qiydi — biz ham */
export function readIniSettings<K extends string>(text: string, keys: readonly K[]): Record<K, string> {
  const out = Object.fromEntries(keys.map(k => [k, ''])) as Record<K, string>;
  const seen = new Set<K>();
  let inSettings = false;
  for (const line of text.split(/\r?\n/)) {
    const section = sectionName(line);
    if (section !== null) { inSettings = section === SETTINGS_SECTION; continue; }
    if (!inSettings) continue;
    const key = keyOf(line);
    const hit = keys.find(k => k.toLowerCase() === key);
    if (!hit || seen.has(hit)) continue;
    seen.add(hit);
    out[hit] = unquote(line.slice(line.indexOf('=') + 1));
  }
  return out;
}
export const readIniHooks = (text: string): HookValues => readIniSettings(text, HOOK_KEYS);

/** MicroSIP'da hisob (operator logini) bormi: [AccountN] (eskilarida [Settings]) da server yoki domen. Hisobsiz — har raqamga «Invalid Number» */
export function iniHasAccount(text: string): boolean {
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const name = sectionName(line);
    if (name !== null) { section = name; continue; }
    if (section !== SETTINGS_SECTION && !/^account\d+$/.test(section)) continue;
    const key = keyOf(line);
    if ((key === 'server' || key === 'domain') && unquote(line.slice(line.indexOf('=') + 1)) !== '') return true;
  }
  return false;
}

/** [Settings] bo'limida berilgan kalitlarni almashtiradi (yo'q bo'lsa qo'shadi). Qolgan satrlarga tegmaydi */
export function patchIniSettings(text: string, values: Partial<Record<string, string>>): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const pending = new Map<string, { key: string; value: string }>();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) pending.set(key.toLowerCase(), { key, value });
  const out: string[] = [];
  let inSettings = false, sawSettings = false;
  /** Bo'lim ichidagi oxirgi bo'sh bo'lmagan satrdan keyingi joy — yangi kalitlar shu yerga tushadi */
  let insertAt = -1;
  const flushMissing = () => {
    if (insertAt < 0 || pending.size === 0) return;
    out.splice(insertAt, 0, ...[...pending.values()].map(p => iniLine(p.key, p.value)));
    pending.clear();
  };
  for (const line of text.split(/\r?\n/)) {
    const section = sectionName(line);
    if (section !== null) {
      if (inSettings) flushMissing();
      inSettings = section === SETTINGS_SECTION;
      if (inSettings) sawSettings = true;
      out.push(line);
      if (inSettings) insertAt = out.length;
      continue;
    }
    if (inSettings) {
      const hit = pending.get(keyOf(line) || '');
      if (hit) {
        out.push(iniLine(hit.key, hit.value));
        pending.delete(hit.key.toLowerCase());
        insertAt = out.length;
        continue;
      }
      out.push(line);
      if (line.trim() !== '') insertAt = out.length;
      continue;
    }
    out.push(line);
  }
  if (inSettings) flushMissing();
  if (!sawSettings && pending.size > 0) {
    while (out.length > 0 && out[out.length - 1].trim() === '') out.pop();
    out.push('[Settings]', ...[...pending.values()].map(p => iniLine(p.key, p.value)), '');
  }
  return out.join(eol);
}

// ─── Raqam va hodisa ─────────────────────────────────────────────────────────

/** Teriladigan raqam: faqat raqam, +, *, # — boshqa narsa MicroSIP'ga uzatilmaydi */
export function sanitizeDialNumber(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[\s()\-.]/g, '');
  return /^\+?[0-9*#]{2,20}$/.test(cleaned) ? cleaned : null;
}

export interface MicrosipEvent {
  event: MicrosipEventName;
  /** MicroSIP bergan raqam (SIP «user» qismi) — raqam bo'lmasligi ham mumkin: «anonymous», «101» */
  number: string;
  /** Hodisa vaqti, ISO (UTC) */
  at: string;
}

/** Yordamchi yozgan fayl: 1-satr hodisa, 2-satr raqam, 3-satr vaqt */
export function parseSpoolEvent(content: string, fallbackTime: Date): MicrosipEvent | null {
  const [rawEvent = '', rawNumber = '', rawTime = ''] = content.split(/\r?\n/);
  const event = EVENT_NAMES.find(e => e === rawEvent.trim().toLowerCase());
  if (!event) return null;
  const number = rawNumber.trim().replace(/[^0-9A-Za-z+*#._-]/g, '').slice(0, 64);
  const parsed = new Date(rawTime.trim());
  return { event, number, at: (isNaN(parsed.getTime()) ? fallbackTime : parsed).toISOString() };
}

// ─── Fayllar qayerda ─────────────────────────────────────────────────────────

export interface MicrosipEnv {
  /** Holat fayli (microsip.json) turadigan papka — Palantir'ning data papkasi */
  stateDir: string;
  /** Yig'ilgan yordamchi (cerebro-call.exe) */
  hookSourceExe: string;
  /** Yordamchi papkasi yaratiladigan joy (%ProgramData%) — yo'lida bo'sh joy bo'lmasligi shart */
  hookRoot: string;
  appData: string;
  localAppData: string;
  programFiles: string[];
  /** Qo'lda ko'rsatilgan microsip.exe (MICROSIP_EXE) */
  exeOverride?: string;
}

export function defaultEnv(stateDir: string, hookSourceExe: string, e: NodeJS.ProcessEnv = process.env): MicrosipEnv {
  return {
    stateDir, hookSourceExe, hookRoot: e.ProgramData || 'C:\\ProgramData', appData: e.APPDATA || '', localAppData: e.LOCALAPPDATA || '',
    programFiles: [e.ProgramFiles, e['ProgramFiles(x86)'], e.ProgramW6432].filter((p): p is string => !!p), exeOverride: e.MICROSIP_EXE || undefined,
  };
}

export const spoolDirOf = (hookDir: string): string => path.join(hookDir, SPOOL_DIR_NAME);
export const recordDirOf = (hookDir: string): string => path.join(hookDir, RECORD_DIR_NAME);
export function hookValuesFor(hookDir: string): HookValues {
  return Object.fromEntries(HOOK_KEYS.map(k => [k, path.join(hookDir, HOOK_FILES[k])])) as HookValues;
}
const samePath = (a: string, b: string): boolean => path.normalize(a).toLowerCase() === path.normalize(b).toLowerCase();
/** Bizning yordamchi papkamizmi: aynan hookRoot ichida va o'z nomimiz bilan */
const isOurHookDir = (dir: string | undefined | null, env: MicrosipEnv): dir is string =>
  !!dir && samePath(path.dirname(dir), env.hookRoot) && path.basename(dir).startsWith(HOOK_DIR_PREFIX);
const isOurPath = (value: string, env: MicrosipEnv): boolean => isOurHookDir(path.dirname(value), env);

/** ini MicroSIP bilan bir papkada bo'lsa — ko'chma nusxa; aks holda %APPDATA%\MicroSIP\MicroSIP.ini */
export function resolveIniPath(exePath: string, env: MicrosipEnv): string {
  const base = path.basename(exePath, path.extname(exePath));
  const portable = path.join(path.dirname(exePath), `${base}.ini`);
  return fs.existsSync(portable) ? portable : path.join(env.appData, base, `${base}.ini`);
}
const defaultExeCandidates = (env: MicrosipEnv): string[] =>
  [env.localAppData, ...env.programFiles].filter(Boolean).map(dir => path.join(dir, 'MicroSIP', 'microsip.exe'));

// ─── Holat fayli ─────────────────────────────────────────────────────────────

export interface MicrosipState {
  /** Qaysi biznes ulagan (bitta kompyuter — bitta klinika) */
  businessId?: string;
  exePath?: string;
  /** Ulanganda yaratilgan yordamchi papkasi (hookRoot ichida) */
  hookDir?: string;
  /** Ulashdan oldin ini'da turgan begona qiymatlar — uzilganda qaytariladi */
  previous?: Partial<Record<SettingKey, string>>;
  connectedAt?: string;
  /** Ulangan paytda MicroSIP'da hisob (operator logini) topilmadi */
  noAccount?: boolean;
  /** Yozuv formati: mp3 (lame_enc.dll bor) yoki wav */
  recordFormat?: 'mp3' | 'wav';
}

export function readState(env: MicrosipEnv): MicrosipState {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(env.stateDir, STATE_FILE), 'utf8'));
    if (parsed && typeof parsed === 'object') return parsed as MicrosipState;
  } catch { /* fayl yo'q yoki buzuq */ }
  return {};
}

export function writeState(env: MicrosipEnv, state: MicrosipState): void {
  fs.mkdirSync(env.stateDir, { recursive: true });
  fs.writeFileSync(path.join(env.stateDir, STATE_FILE), JSON.stringify(state, null, 2));
}

// ─── Windows bilan ishlash (jarayon, registr, ruxsatlar) ─────────────────────

/** Sinovda almashtiriladigan tizim amallari */
export interface MicrosipSystem {
  isRunning(exePath: string): Promise<boolean>;
  requestExit(exePath: string): void;
  start(exePath: string, args?: string[]): void;
  registryExeCandidates(): Promise<string[]>;
  runningExePath(): Promise<string | null>;
  /** Papkani faqat egasi, tizim va administratorlarga qoldiradi. false — bajarilmadi */
  secureDir(dir: string): Promise<boolean>;
}

// Tizim dasturlari to'liq yo'li bilan: PATH'dagi shu nomli begona dastur (Git'ning whoami'si) ishga tushib ketmasin
const SYSTEM32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
const TOOL = {
  tasklist: path.join(SYSTEM32, 'tasklist.exe'), reg: path.join(SYSTEM32, 'reg.exe'), whoami: path.join(SYSTEM32, 'whoami.exe'),
  icacls: path.join(SYSTEM32, 'icacls.exe'), powershell: path.join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
};
const run = (file: string, args: string[]): Promise<{ code: number; stdout: string }> => new Promise(resolve => {
  execFile(file, args, { windowsHide: true, timeout: 8000 }, (err, stdout) => {
    const code = err ? (typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === 'number' ? Number((err as { code: number }).code) : 1) : 0;
    resolve({ code, stdout: String(stdout || '') });
  });
});
const launch = (exePath: string, args: string[]): void => {
  // cwd — MicroSIP papkasi: ko'chma nusxa ini'ni joriy papkadan qidiradi
  const child = spawn(exePath, args, { cwd: path.dirname(exePath), detached: true, stdio: 'ignore' });
  child.on('error', err => console.error('[MicroSIP] ishga tushmadi:', err.message));
  child.unref();
};
const REGISTRY_KEYS = [
  'HKCU\\Software\\MicroSIP', 'HKLM\\Software\\MicroSIP', 'HKLM\\Software\\WOW6432Node\\MicroSIP',
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MicroSIP', 'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MicroSIP',
  'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MicroSIP',
];

/** `reg query` chiqishidagi yo'llardan microsip.exe nomzodlari */
export function exeCandidatesFromRegOutput(output: string): string[] {
  const found: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const m = /REG_(?:EXPAND_)?SZ\s+(.+)$/.exec(line);
    if (!m) continue;
    const value = m[1].trim().replace(/^"|"$/g, '').replace(/",.*$/, '').replace(/,\d+$/, '');
    if (!/^[A-Za-z]:\\/.test(value)) continue;
    found.push(path.join(/\.[A-Za-z0-9]{2,4}$/.test(value) ? path.dirname(value) : value, 'microsip.exe'));
  }
  return [...new Set(found)];
}

// Windows'ning tilga bog'liq bo'lmagan belgilari: papka egasi, tizim, administratorlar
const SID_OWNER_RIGHTS = '*S-1-3-4', SID_SYSTEM = '*S-1-5-18', SID_ADMINISTRATORS = '*S-1-5-32-544';

export const windowsSystem: MicrosipSystem = {
  async isRunning(exePath) {
    const image = path.basename(exePath);
    const out = await run(TOOL.tasklist, ['/FI', `IMAGENAME eq ${image}`, '/FO', 'CSV', '/NH']);
    // Javob kelmasa «ishlamayapti» deb bo'lmaydi: ini MicroSIP ochiq paytda yozilib, u yopilganda o'chib ketardi
    if (out.code !== 0) throw new Error("MicroSIP ishlayotganini aniqlab bo'lmadi (tasklist)");
    return out.stdout.toLowerCase().includes(`"${image.toLowerCase()}"`);
  },
  requestExit(exePath) { launch(exePath, ['/exit']); },
  start(exePath, args = []) { launch(exePath, args); },
  async registryExeCandidates() {
    const outputs = await Promise.all(REGISTRY_KEYS.map(key => run(TOOL.reg, ['query', key])));
    return exeCandidatesFromRegOutput(outputs.map(o => o.stdout).join('\n'));
  },
  async runningExePath() {
    const out = await run(TOOL.powershell, ['-NoProfile', '-NonInteractive', '-Command', '(Get-Process microsip -ErrorAction SilentlyContinue | Select-Object -First 1).Path']);
    const value = out.stdout.trim();
    return value && /\.exe$/i.test(value) ? value : null;
  },
  async secureDir(dir) {
    // Joriy foydalanuvchi aniq yoziladi: server administrator nomidan ochilgan bo'lsa ham oddiy huquqli MicroSIP yordamchini ishga tushira olsin
    const who = await run(TOOL.whoami, ['/user', '/fo', 'csv', '/nh']);
    const userSid = /"(S-1-[0-9-]+)"/.exec(who.stdout)?.[1];
    const principals = [SID_OWNER_RIGHTS, SID_SYSTEM, SID_ADMINISTRATORS, ...(userSid ? [`*${userSid}`] : [])];
    const applied = await run(TOOL.icacls, [dir, '/inheritance:r', '/grant:r', ...principals.map(p => `${p}:(OI)(CI)F`), '/Q']);
    if (applied.code !== 0) return false;
    // Meros ruxsat («(I)») qolmaganini tekshiramiz — aynan shular orqali boshqa foydalanuvchilar yoza olardi
    const listing = await run(TOOL.icacls, [dir]);
    return listing.code === 0 && listing.stdout.trim() !== '' && !/\(I\)/.test(listing.stdout);
  },
};

// ─── Topish, holat, ulash, uzish ─────────────────────────────────────────────

export interface MicrosipPaths { exePath: string; iniPath: string }
const isExeFile = (p: string | undefined | null): p is string => !!p && /\.exe$/i.test(p) && fs.existsSync(p);

export async function locateMicrosip(env: MicrosipEnv, sys: MicrosipSystem, state: MicrosipState): Promise<MicrosipPaths | null> {
  let exePath = [env.exeOverride, state.exePath, ...defaultExeCandidates(env)].find(isExeFile);
  if (!exePath) exePath = (await sys.registryExeCandidates()).find(isExeFile);
  if (!exePath) {
    const running = await sys.runningExePath();
    if (isExeFile(running)) exePath = running;
  }
  return exePath ? { exePath, iniPath: resolveIniPath(exePath, env) } : null;
}

export interface MicrosipStatus {
  exePath: string | null;
  connected: boolean;
  /** Ulangan paytda MicroSIP'da hisob yo'q edi va shundan beri hisob ishlayotganini isbotlaydigan qo'ng'iroq bo'lmadi */
  noAccount: boolean;
  /** Suhbatlar yozib olinadi (ulanganda yoqilgan) */
  recording: boolean;
  recordFormat: 'mp3' | 'wav' | null;
}

/**
 * Holat o'z yozuvimizdan (microsip.json) olinadi — ini O'QILMAYDI: ishlab turgan MicroSIP sozlama fayliga yoza olmay qolsa
 * «Failed to open file for writing» oynasida qotib qoladi (jonli sinovda ko'rilgan)
 */
export async function getStatus(env: MicrosipEnv, sys: MicrosipSystem): Promise<MicrosipStatus> {
  const state = readState(env);
  const paths = await locateMicrosip(env, sys, state);
  const helpersInPlace = isOurHookDir(state.hookDir, env) && REQUIRED_HOOK_KEYS.every(k => fs.existsSync(path.join(state.hookDir as string, HOOK_FILES[k])));
  const connected = !!paths && !!state.connectedAt && helpersInPlace;
  return { exePath: paths?.exePath ?? null, connected, noAccount: connected && !!state.noAccount, recording: connected, recordFormat: connected ? state.recordFormat ?? null : null };
}

/** Hisob ishlayotganini isbotlaydigan hodisa keldi: «hisob yo'q» belgisi olinadi. true — belgi bor edi */
export function markAccountWorking(env: MicrosipEnv): boolean {
  const state = readState(env);
  if (!state.noAccount) return false;
  writeState(env, { ...state, noAccount: undefined });
  return true;
}

/** Hodisalar va yozuvlar papkasi (ulanmagan bo'lsa — null) */
export function activeDirs(env: MicrosipEnv): { spool: string; records: string } | null {
  const { hookDir, connectedAt } = readState(env);
  return connectedAt && isOurHookDir(hookDir, env) && fs.existsSync(hookDir) ? { spool: spoolDirOf(hookDir), records: recordDirOf(hookDir) } : null;
}

export type ConnectFailure = 'not_found' | 'ini_missing' | 'hooks_taken' | 'exit_failed' | 'helper_missing' | 'error';
export type ConnectResult =
  | { ok: true; restarted: boolean; noAccount: boolean; recordFormat: 'mp3' | 'wav' }
  | { ok: false; reason: ConnectFailure; message?: string; existing?: Partial<HookValues> };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function stopIfRunning(exePath: string, sys: MicrosipSystem): Promise<{ wasRunning: boolean; stopped: boolean }> {
  if (!(await sys.isRunning(exePath))) return { wasRunning: false, stopped: true };
  sys.requestExit(exePath);
  for (const deadline = Date.now() + EXIT_WAIT_MS; Date.now() < deadline;) {
    await sleep(EXIT_POLL_MS);
    if (!(await sys.isRunning(exePath))) return { wasRunning: true, stopped: true };
  }
  return { wasRunning: true, stopped: false };
}

/** Yordamchi papkasi: oldingisi bo'lsa — o'sha, bo'lmasa tasodifiy nomli yangisi (faqat o'zimiz yaratamiz — egasi biz) */
async function prepareHookDir(env: MicrosipEnv, sys: MicrosipSystem, state: MicrosipState): Promise<string> {
  if (isOurHookDir(state.hookDir, env) && fs.existsSync(state.hookDir)) {
    if (!(await sys.secureDir(state.hookDir))) throw new Error("Yordamchi papkasini himoyalab bo'lmadi");
    return state.hookDir;
  }
  if (!SAFE_PATH.test(env.hookRoot)) throw new Error(`Yordamchi papkasi yo'lida bo'sh joy yoki lotincha bo'lmagan harf bor: ${env.hookRoot}`);
  for (let attempt = 0; attempt < HOOK_DIR_ATTEMPTS; attempt++) {
    const dir = path.join(env.hookRoot, HOOK_DIR_PREFIX + randomBytes(4).toString('hex'));
    try { fs.mkdirSync(dir); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'EEXIST') continue; throw err; }
    if (await sys.secureDir(dir)) return dir;
    try { fs.rmdirSync(dir); } catch { /* bo'sh papka qolsa zarari yo'q */ }
    throw new Error("Yordamchi papkasini himoyalab bo'lmadi");
  }
  throw new Error("Yordamchi papkasini yaratib bo'lmadi");
}

function installHookFiles(env: MicrosipEnv, hookDir: string): void {
  const source = fs.readFileSync(env.hookSourceExe);
  fs.mkdirSync(spoolDirOf(hookDir), { recursive: true });
  fs.mkdirSync(recordDirOf(hookDir), { recursive: true });
  for (const key of HOOK_KEYS) {
    const target = path.join(hookDir, HOOK_FILES[key]);
    fs.writeFileSync(target, source);
    if (!fs.readFileSync(target).equals(source)) throw new Error(`Yordamchi faylni yozib bo'lmadi: ${target}`);
  }
}

function writeIni(iniPath: string, values: Partial<Record<string, string>>): void {
  const ini = decodeIni(fs.readFileSync(iniPath));
  const backup = iniPath + INI_BACKUP_SUFFIX;
  if (!fs.existsSync(backup)) fs.copyFileSync(iniPath, backup);
  // Fayl O'Z JOYIDA yoziladi: «yoniga yozib almashtirish»da antivirus yangi faylni ushlab turadi va MicroSIP qotib qoladi (sinalgan)
  fs.writeFileSync(iniPath, encodeIni({ ...ini, text: patchIniSettings(ini.text, values) }));
}

/** ini'dagi bizniki bo'lmagan buyruqlar (boshqa dastur ulagan) */
const foreignHooks = (current: HookValues, env: MicrosipEnv): Partial<HookValues> =>
  Object.fromEntries(HOOK_KEYS.filter(k => current[k] && !isOurPath(current[k], env)).map(k => [k, current[k]]));

export async function connectMicrosip(env: MicrosipEnv, sys: MicrosipSystem, opts: { overwrite?: boolean } = {}): Promise<ConnectResult> {
  const state = readState(env);
  const paths = await locateMicrosip(env, sys, state);
  if (!paths) return { ok: false, reason: 'not_found' };
  if (!fs.existsSync(paths.iniPath)) return { ok: false, reason: 'ini_missing' };
  if (!fs.existsSync(env.hookSourceExe)) return { ok: false, reason: 'helper_missing' };
  // Papka MicroSIP yopilishidan OLDIN tayyorlanadi: bu yerda xato chiqsa, MicroSIP bezovta qilinmaydi
  let hookDir: string;
  try {
    hookDir = await prepareHookDir(env, sys, state);
    installHookFiles(env, hookDir);
  } catch (err) {
    return { ok: false, reason: 'error', message: (err as Error).message };
  }
  const recordFormat: 'mp3' | 'wav' = fs.existsSync(path.join(path.dirname(paths.exePath), 'lame_enc.dll')) ? 'mp3' : 'wav';
  const prepared: MicrosipState = { ...state, exePath: paths.exePath, hookDir, connectedAt: undefined };
  writeState(env, prepared);

  let wasRunning = false;
  try {
    const stop = await stopIfRunning(paths.exePath, sys);
    if (!stop.stopped) return { ok: false, reason: 'exit_failed' };
    wasRunning = stop.wasRunning;
  } catch (err) {
    return { ok: false, reason: 'error', message: (err as Error).message };
  }
  // ini faqat shu yerda — MicroSIP yopilgach — ochiladi (u yopilayotganda yozgan oxirgi holati o'qiladi)
  try {
    let iniText: string;
    try { iniText = decodeIni(fs.readFileSync(paths.iniPath)).text; } catch { return { ok: false, reason: 'ini_missing' }; }
    const taken = foreignHooks(readIniHooks(iniText), env);
    if (Object.keys(taken).length > 0 && !opts.overwrite) return { ok: false, reason: 'hooks_taken', existing: taken };
    const noAccount = !iniHasAccount(iniText);
    // Oldingi yozuv sozlamalari (o'zimiznikidan tashqari) — uzilganda qaytariladi
    const rec = readIniSettings(iniText, RECORD_KEYS);
    // Yozuv papkasi (<yordamchi>\rec) bizniki bo'lsa — oldingi ulanishda saqlangan asl qiymatlar qoladi
    const prevRecord = rec.recordingPath && isOurPath(rec.recordingPath, env) ? state.previous ?? {} : rec;
    const withPrevious: MicrosipState = { ...prepared, recordFormat, previous: { ...state.previous, ...taken, ...pickRecord(prevRecord) } };
    writeState(env, withPrevious);
    writeIni(paths.iniPath, { ...hookValuesFor(hookDir), autoRecording: '1', recordingPath: recordDirOf(hookDir), recordingFormat: recordFormat === 'mp3' ? 'mp3' : '' });
    const after = readIniSettings(decodeIni(fs.readFileSync(paths.iniPath)).text, SETTING_KEYS);
    const ours = hookValuesFor(hookDir);
    if (!REQUIRED_HOOK_KEYS.every(k => samePath(after[k], ours[k])) || after.autoRecording !== '1') throw new Error("ini'ga yozilgan sozlama o'qilmadi");
    writeState(env, { ...withPrevious, connectedAt: new Date().toISOString(), noAccount: noAccount || undefined });
    return { ok: true, restarted: wasRunning, noAccount, recordFormat };
  } catch (err) {
    return { ok: false, reason: 'error', message: (err as Error).message };
  } finally {
    if (wasRunning) sys.start(paths.exePath);
  }
}
const pickRecord = (v: Partial<Record<string, string>>): Partial<Record<RecordKey, string>> =>
  Object.fromEntries(RECORD_KEYS.filter(k => v[k] !== undefined).map(k => [k, v[k]!]));

export type DisconnectResult = { ok: true; restarted: boolean } | { ok: false; reason: 'exit_failed' | 'error'; message?: string };

export async function disconnectMicrosip(env: MicrosipEnv, sys: MicrosipSystem): Promise<DisconnectResult> {
  const state = readState(env);
  const paths = await locateMicrosip(env, sys, state);
  let restarted = false;
  if (paths && fs.existsSync(paths.iniPath)) {
    let wasRunning = false;
    try {
      const stop = await stopIfRunning(paths.exePath, sys);
      if (!stop.stopped) return { ok: false, reason: 'exit_failed' };
      wasRunning = stop.wasRunning;
    } catch (err) {
      return { ok: false, reason: 'error', message: (err as Error).message };
    }
    try {
      const current = readIniSettings(decodeIni(fs.readFileSync(paths.iniPath)).text, SETTING_KEYS);
      const restore: Partial<Record<SettingKey, string>> = {};
      for (const key of HOOK_KEYS) if (current[key] && isOurPath(current[key], env)) restore[key] = state.previous?.[key] || '';
      // Yozish sozlamasi bizniki bo'lsa — oldingisi (bo'lmasa o'chiq) qaytariladi
      if (current.recordingPath && isOurPath(current.recordingPath, env)) {
        for (const key of RECORD_KEYS) restore[key] = state.previous?.[key] ?? (key === 'autoRecording' ? '0' : '');
      }
      if (Object.keys(restore).length > 0) writeIni(paths.iniPath, restore);
    } catch (err) {
      return { ok: false, reason: 'error', message: (err as Error).message };
    } finally {
      if (wasRunning) sys.start(paths.exePath);
    }
    restarted = wasRunning;
  }
  // Yordamchi papkasi qoladi (unda o'qilmagan yozuvlar bo'lishi mumkin) — keyingi ulanishda shu ishlatiladi
  writeState(env, { exePath: state.exePath, hookDir: state.hookDir });
  return { ok: true, restarted };
}

export type DialResult = { ok: true; noAccount?: boolean } | { ok: false; reason: 'bad_number' | 'not_found' };

export async function dialNumber(env: MicrosipEnv, sys: MicrosipSystem, rawNumber: unknown): Promise<DialResult> {
  const number = sanitizeDialNumber(rawNumber);
  if (!number) return { ok: false, reason: 'bad_number' };
  const state = readState(env);
  const paths = await locateMicrosip(env, sys, state);
  if (!paths) return { ok: false, reason: 'not_found' };
  sys.start(paths.exePath, [number]);
  return state.connectedAt && state.noAccount ? { ok: true, noAccount: true } : { ok: true };
}

/** Yordamchining yangi nusxasi (Palantir yangilangan) — ulangan papkadagi nusxalar ham yangilanadi. Band bo'lsa — keyingi safar */
export function refreshHookFiles(env: MicrosipEnv): void {
  const { hookDir } = readState(env);
  if (!isOurHookDir(hookDir, env) || !fs.existsSync(hookDir) || !fs.existsSync(env.hookSourceExe)) return;
  const source = fs.readFileSync(env.hookSourceExe);
  for (const key of HOOK_KEYS) {
    const target = path.join(hookDir, HOOK_FILES[key]);
    try { if (!fs.existsSync(target) || !fs.readFileSync(target).equals(source)) fs.writeFileSync(target, source); } catch { /* band */ }
  }
}

// ─── Hodisalarni o'qish ──────────────────────────────────────────────────────

const removeQuietly = (file: string): void => { try { fs.unlinkSync(file); } catch { /* band yoki yo'q */ } };

/** Papkadagi tayyor hodisalarni eskidan yangiga qarab o'qiydi va o'chiradi */
export function drainSpool(dir: string, onEvent: (event: MicrosipEvent) => void, now: Date = new Date()): number {
  let names: string[];
  try { names = fs.readdirSync(dir); } catch { return 0; }
  const ready: string[] = [];
  for (const name of names) {
    if (SPOOL_FILE.test(name)) { ready.push(name); continue; }
    // Yozilayotgan .tmp tegilmaydi; uzoq qolib ketgani va begona fayllar tozalanadi
    const file = path.join(dir, name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isFile() && ((name.endsWith('.tmp') && now.getTime() - stat.mtimeMs > SPOOL_STALE_TMP_MS) || !name.endsWith('.tmp'))) removeQuietly(file);
    } catch { /* keyingi aylanishda */ }
  }
  ready.sort();
  for (const name of ready.length > SPOOL_MAX_FILES ? ready.splice(0, ready.length - SPOOL_MAX_FILES) : []) removeQuietly(path.join(dir, name));
  let delivered = 0;
  for (const name of ready) {
    const file = path.join(dir, name);
    try {
      const stat = fs.lstatSync(file);
      // Yordamchi bir necha o'n bayt yozadi: katta yoki oddiy fayl bo'lmagan narsa — bizniki emas
      if (!stat.isFile() || stat.size > SPOOL_MAX_BYTES) { removeQuietly(file); continue; }
      const event = parseSpoolEvent(fs.readFileSync(file, 'utf8'), stat.mtime);
      fs.unlinkSync(file);
      if (!event || now.getTime() - new Date(event.at).getTime() > SPOOL_MAX_AGE_MS) continue;
      onEvent(event);
      delivered++;
    } catch { /* fayl band — keyingi aylanishda */ }
  }
  return delivered;
}

export interface SpoolReader { stop(): void }

export function readSpool(dir: string, onEvent: (event: MicrosipEvent) => void): SpoolReader {
  let watcher: fs.FSWatcher | null = null;
  let debounce: NodeJS.Timeout | null = null;
  const drain = () => { drainSpool(dir, onEvent); };
  drain();
  try {
    watcher = fs.watch(dir, () => { if (!debounce) debounce = setTimeout(() => { debounce = null; drain(); }, 50); });
    // Papka o'chirilsa Windows xato beradi — ushlanmasa butun server yiqilardi
    watcher.on('error', () => { watcher?.close(); watcher = null; });
  } catch { watcher = null; }
  // fs.watch ba'zan hodisani o'tkazib yuboradi — siyrak tekshiruv ham bor
  const timer = setInterval(drain, SPOOL_POLL_MS);
  return {
    stop() {
      watcher?.close();
      clearInterval(timer);
      if (debounce) clearTimeout(debounce);
    },
  };
}
