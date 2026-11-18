/**
 * Telefon xizmatini (WSL + Asterisk) MASOFADAN o'rnatish — Hub → mijoz kartasi → «Telefon xizmatini o'rnatish» (server/hubCommands.ts, «phone»).
 *
 * Muammo: o'rnatish Windows administrator huquqini talab qiladi, Palantir esa oddiy huquq bilan ishlaydi — o'zi so'rasa, klinika ekranida
 * «Ha / Yo'q» chiqadi va uni bosadigan odam kerak. Yechim: o'rnatish paytida (administrator huquqi bor payt) Windows vazifasi
 * «PalantirTelefon» yaratiladi (install/telefon-vazifa.ps1): eng yuqori huquq bilan, shu foydalanuvchi nomidan, triggersiz. Palantir uni
 * `schtasks /run` bilan ishga tushiradi — vazifa faqat bitta ishni qiladi (install/telefon.ps1 -Remote), unga parametr berilmaydi.
 * Ekranda hech narsa ochilmaydi.
 *
 * Holat — tgvoice/telefon-ornatish.json (skript yozadi): running | reboot | done | failed, qaysi qadamda, sababi. Jurnal —
 * tgvoice/telefon-ornatish.log (diagnostikaga kiradi). WSL birinchi marta yoqilsa — «reboot»: jamoa Hub'dan kompyuterni qayta yoqadi,
 * Palantir yonganda o'rnatishni o'zi davom ettiradi (Windows'ga kirish shart emas — RunOnce kerak emas).
 *
 * Eslatma (xavfsizlik): vazifani shu Windows foydalanuvchisining istalgan dasturi ishga tushira oladi va dastur papkasi ham shu
 * foydalanuvchiniki — ya'ni shu foydalanuvchi nomidan ishlagan zararli dastur administrator so'rovisiz huquq olishi mumkin. Foydalanuvchi
 * baribir administrator (aks holda vazifa huquq bermaydi); Microsoft UAC'ni chegara deb hisoblamaydi. Klinika kompyuterida shu qabul qilingan.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { uptime } from 'node:os';
import { resolve } from 'node:path';

export const PHONE_TASK = 'PalantirTelefon';
const STATUS_FILE = resolve('tgvoice', 'telefon-ornatish.json');
/** O'rnatish jurnali (install/telefon.ps1 yozadi) — diagnostikaga kiradi */
export const INSTALL_LOG = resolve('tgvoice', 'telefon-ornatish.log');
const SCRIPT = resolve('install', 'telefon.ps1');
const SCHTASKS_TIMEOUT_MS = 30_000;
/** Vazifa bor-yo'qligi (schtasks so'rovi) — heartbeat har 5 daqiqada so'raydi; vazifa kamdan-kam o'zgaradi */
const READY_CACHE_MS = 10 * 60_000;
const ENABLED = () => process.platform === 'win32' && process.env.ASTERISK_WSL !== '0';

export type InstallPhase = 'running' | 'reboot' | 'done' | 'failed';
export interface InstallStatus { phase: InstallPhase; note: string; step: string; pid: number; at: string }
/**
 * Fayldagi holat + hozirgi ahvol: stalled — «running» yozilgan, lekin jarayon yo'q (kompyuter o'chgan, vazifa vaqti tugagan);
 * rebooted — qayta yoqish kerak edi va kompyuter shundan keyin yongan (o'rnatishni davom ettirish kerak)
 */
export type InstallState = Omit<InstallStatus, 'phase'> & { phase: InstallPhase | 'stalled' | 'rebooted' };

const PHASES: InstallPhase[] = ['running', 'reboot', 'done', 'failed'];

/** Skript yozgan holat; yo'q yoki buzilgan bo'lsa — null */
export function parseInstallStatus(text: string): InstallStatus | null {
  try {
    const j = JSON.parse(text.replace(/^﻿/, '')) as Record<string, unknown>;
    const phase = String(j.phase) as InstallPhase;
    if (!PHASES.includes(phase) || !Number.isFinite(Date.parse(String(j.at)))) return null;
    return { phase, note: String(j.note ?? '').slice(0, 300), step: String(j.step ?? '').slice(0, 120), pid: Number(j.pid) || 0, at: String(j.at) };
  } catch { return null; }
}

/**
 * «Qayta yoqish kerak» shuncha vaqt ichida yonsa — o'rnatish o'zi davom etadi. Eskisi (masalan, o'rnatish keyin qo'lda tugatilgan va bir oy
 * o'tib kompyuter oddiy qayta yoqilgan) — davom ettirilmaydi: administrator huquqli o'rnatish hech kim so'ramasdan qayta yurmasin
 */
export const CONTINUE_WITHIN_MS = 48 * 3_600_000;

/** Sof hisob (sinaladi): jarayon tirikmi va kompyuter qachon yonganiga qarab */
export function installState(s: InstallStatus | null, alive: (pid: number) => boolean, bootAt: number): InstallState | null {
  if (!s) return null;
  // Holat yozilgandan keyin kompyuter qayta yongan: o'shandagi jarayon raqami endi boshqa dasturniki bo'lishi mumkin
  const rebootedSince = bootAt > Date.parse(s.at);
  if (s.phase === 'running' && (rebootedSince || !s.pid || !alive(s.pid))) return { ...s, phase: 'stalled' };
  if (s.phase === 'reboot' && rebootedSince) return { ...s, phase: bootAt - Date.parse(s.at) <= CONTINUE_WITHIN_MS ? 'rebooted' : 'stalled' };
  return s;
}

/**
 * Server o'zi holatni yopadi (davom ettirib bo'lmadi): keyingi yonishlarda qayta urinmasin va egasiga har safar yozmasin.
 * Faylga skript (administrator) ham yozadi — papka shu foydalanuvchiniki, yozish mumkin; bo'lmasa — jurnalga
 */
export function markInstallFailed(note: string, step = ''): void {
  const body = JSON.stringify({ phase: 'failed', note: note.slice(0, 300), step, pid: 0, at: new Date().toISOString() });
  try { writeFileSync(STATUS_FILE, body); } catch (e) { console.warn("[telefon] o'rnatish holati yozilmadi:", (e as Error).message); }
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

export function readInstallState(): InstallState | null {
  let text: string;
  try { text = readFileSync(STATUS_FILE, 'utf8'); } catch { return null; }
  return installState(parseInstallStatus(text), alive, Date.now() - uptime() * 1000);
}

const schtasks = (args: string[]) => new Promise<number>(done => {
  execFile('schtasks.exe', args, { windowsHide: true, timeout: SCHTASKS_TIMEOUT_MS }, e => done(e ? Number((e as { code?: unknown }).code) || 1 : 0));
});

let ready: { at: number; value: boolean } | null = null;
/** Shu kompyuterda masofadan o'rnatish vazifasi bormi (o'rnatish administrator huquqi bilan o'tgan) */
export async function remoteInstallReady(now = Date.now()): Promise<boolean> {
  if (!ENABLED() || !existsSync(SCRIPT)) return false;
  if (ready && now - ready.at < READY_CACHE_MS) return ready.value;
  ready = { at: now, value: (await schtasks(['/query', '/tn', PHONE_TASK])) === 0 };
  return ready.value;
}

/** Heartbeat uchun (sinxron): oxirgi ma'lum javob; eskirgan bo'lsa fonda yangilanadi. null — hali so'ralmagan */
export function remoteInstallKnown(now = Date.now()): boolean | null {
  if (!ENABLED()) return false;
  if (!ready || now - ready.at >= READY_CACHE_MS) void remoteInstallReady(now).catch(() => null);
  return ready?.value ?? null;
}

/** Vazifa yo'q bo'lganda nima qilish kerak — jamoaga aniq ko'rsatma */
export const NO_TASK = "Bu kompyuterda masofadan o'rnatish yoqilmagan (Palantir administrator huquqisiz yoki eski nashrda o'rnatilgan). "
  + "Bir marta klinika kompyuterida: panel → Sozlamalar → Telefon liniyasi → «Telefon xizmatini o'rnatish» (yoki Palantir exe'sini qayta ishga tushirish) "
  + "va Windows so'roviga «Ha». Keyingi safar — shu tugma bilan, masofadan";

/** O'rnatishni boshlaydi. Qaytaradi: rad sababi yoki null (boshlandi) */
export async function startRemoteInstall(): Promise<string | null> {
  if (!ENABLED()) return "Telefon xizmati faqat Windows klinika kompyuterida o'rnatiladi";
  if (!existsSync(SCRIPT)) return "O'rnatgich topilmadi (install/telefon.ps1)";
  ready = null;
  if (!(await remoteInstallReady())) return NO_TASK;
  const code = await schtasks(['/run', '/tn', PHONE_TASK]);
  return code === 0 ? null : `Windows vazifasi ishga tushmadi (schtasks kodi ${code})`;
}
