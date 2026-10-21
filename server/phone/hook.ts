/**
 * MicroSIP yordamchisini (hook/PalantirCall.cs) yig'adi — Windows'ning o'zidagi .NET Framework kompilyatori (csc.exe) bilan.
 * Repozitoriyda tayyor .exe saqlanmaydi: kerak bo'lganda (MicroSIP ulanayotganda) data papkasiga yig'iladi; manba o'zgarsa — qayta.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'hook', 'PalantirCall.cs');
const COMPILE_TIMEOUT_MS = 60_000;

const compilers = (): string[] => {
  const win = process.env.WINDIR || process.env.SystemRoot || 'C:\\Windows';
  return [path.join(win, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'), path.join(win, 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')];
};

/** Yig'ilgan yordamchi yo'li (yo'q yoki eski bo'lsa — yig'adi). Windows bo'lmasa yoki kompilyator topilmasa — Error */
export async function ensureHookExe(dir: string): Promise<string> {
  const source = fs.readFileSync(SOURCE);
  const tag = createHash('sha256').update(source).digest('hex').slice(0, 12);
  const exe = path.join(dir, 'palantir-call.exe');
  const stamp = path.join(dir, 'palantir-call.version');
  if (fs.existsSync(exe) && fs.existsSync(stamp) && fs.readFileSync(stamp, 'utf8').trim() === tag) return exe;
  const csc = compilers().find(p => fs.existsSync(p));
  if (!csc) throw new Error(".NET Framework 4 kompilyatori (csc.exe) topilmadi — MicroSIP yordamchisini yig'ib bo'lmadi");
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${exe}.tmp.exe`;
  await new Promise<void>((resolve, reject) => {
    execFile(csc, ['/nologo', '/target:winexe', '/optimize+', '/platform:anycpu', `/out:${tmp}`, SOURCE], { windowsHide: true, timeout: COMPILE_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(new Error(`MicroSIP yordamchisi yig'ilmadi: ${String(stdout || err.message).trim().slice(0, 300)}`));
      else resolve();
    });
  });
  fs.renameSync(tmp, exe);
  fs.writeFileSync(stamp, tag);
  return exe;
}
