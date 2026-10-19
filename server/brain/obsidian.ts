/**
 * «Miya» tugmasi: papkani Obsidian'ning o'zida ochish. Obsidian faqat o'z ro'yxatidagi papkani ochadi (aks holda «Vault not found»),
 * shuning uchun papka avval shu kompyuterdagi Obsidian ro'yxatiga (obsidian.json) qo'shiladi, keyin havola uni ochadi.
 *
 * Havolani brauzer ochadi (egasi tugmani bosgan — Windows Obsidian oynasini oldinga chiqaradi). Ko'chma o'rnatishda Obsidian
 * odatiy profil papkasidan (%APPDATA%\obsidian) foydalansin — u ko'chma papkaga bog'lama (junction) bo'lishi kerak, aks holda
 * havola Obsidian'ni bo'sh profil bilan ochadi («Vault not found»). Server va Obsidian bir kompyuterda.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

interface VaultList { vaults?: Record<string, { path: string; ts?: number; open?: boolean }>; [k: string]: unknown }
interface Setup { exe: string | null; home: string; custom: boolean }

/** Obsidian qayerda va sozlamalari qayerda: havola ochuvchi buyrug'idan; ko'chma o'rnatish (exe yonida data\obsidian.json) ham */
export function obsidianSetup(): Setup {
  const fallbackHome = process.platform === 'win32'
    ? join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'obsidian')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'obsidian') : join(homedir(), '.config', 'obsidian');
  if (process.platform !== 'win32') return { exe: null, home: fallbackHome, custom: false };
  const r = spawnSync('reg', ['query', 'HKCU\\Software\\Classes\\obsidian\\shell\\open\\command', '/ve'], { encoding: 'utf8', windowsHide: true });
  const command = r.stdout ?? '';
  const exe = /"([^"]*Obsidian\.exe)"/i.exec(command)?.[1] ?? null;
  const flag = /--user-data-dir=(?:"([^"]+)"|(\S+))/.exec(command);
  if (flag) return { exe, home: flag[1] ?? flag[2], custom: true };
  // Ko'chma o'rnatish: <papka>\app\Obsidian.exe va sozlamalar <papka>\data da (Obsidian.cmd shunday yoqadi)
  const portable = exe ? join(dirname(dirname(exe)), 'data') : null;
  if (portable && existsSync(join(portable, 'obsidian.json'))) return { exe, home: portable, custom: true };
  return { exe, home: fallbackHome, custom: false };
}

const same = (a: string, b: string) => {
  const norm = (p: string) => resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b);
};

/** Papka Obsidian ro'yxatida bo'lsin; qaytaradi: uning id'si */
function registerVault(home: string, dir: string): string {
  const file = join(home, 'obsidian.json');
  const list: VaultList = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) as VaultList : {};
  const vaults = list.vaults ?? {};
  const known = Object.entries(vaults).find(([, v]) => v?.path && same(v.path, dir))?.[0];
  if (known) return known;
  const id = randomBytes(8).toString('hex');
  mkdirSync(home, { recursive: true });
  writeFileSync(file, JSON.stringify({ ...list, vaults: { ...vaults, [id]: { path: dir, ts: Date.now() } } }));
  return id;
}

/** Papka Obsidian ro'yxatida bo'lsin; qaytaradi: uni mundarija (INDEKS) bilan ochadigan havola — brauzer ochadi */
export function obsidianLink(dir: string): string {
  const page = existsSync(join(dir, 'INDEKS.md')) ? '&file=INDEKS' : '';
  try {
    return `obsidian://open?vault=${registerVault(obsidianSetup().home, dir)}${page}`;
  } catch (e) {
    console.error("[miya] Obsidian ro'yxati:", (e as Error).message);
    return `obsidian://open?path=${encodeURIComponent(dir)}`;
  }
}
