/**
 * Dasturchining ish nusxasi: loyihaning o'zida emas, alohida papkada (git worktree, o'z shoxida) ishlanadi — egasining ochiq turgan,
 * saqlanmagan o'zgarishlari bor loyihasiga tegilmaydi. O'zgarish loyihaga faqat egasi «Qabul qilish» ni bosganda qo'shiladi (merge).
 *
 * node_modules: ish nusxasida tekshiruv (tsc, test) ishlashi uchun asl loyihaning node_modules papkasi ULANADI (junction).
 * Ulanma orqali asl papka o'chib ketmasin: ish nusxasi o'chirilishidan OLDIN ulanmalar uziladi (unlinkModules) — uzilmasa, nusxa
 * o'chirilmaydi. (2026-11-16: `git worktree remove` ulanma orqali asl node_modules'ni o'chirgan.)
 */
import { execFile } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, sep } from 'node:path';

export class GitError extends Error {}

const MAX_OUT = 20 * 1024 * 1024;
/** git buyrug'i; xato bo'lsa — GitError (git'ning o'z matni bilan) */
export const git = (cwd: string, ...args: string[]): Promise<string> => new Promise((done, fail) => {
  execFile('git', args, { cwd, maxBuffer: MAX_OUT, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
    if (err) fail(new GitError((stderr || stdout || err.message).trim().slice(0, 600)));
    else done(stdout.trim());
  });
});

export interface Work { dir: string; branch: string; base: string }

/** Papka git loyihasining ildizimi */
export async function isRepo(dir: string): Promise<boolean> {
  if (!existsSync(join(dir, '.git'))) return false;
  return git(dir, 'rev-parse', '--is-inside-work-tree').then(out => out === 'true', () => false);
}

/** Ulanadigan papkalar: ildizdagi va bir qavat ichidagi node_modules (backend/node_modules) */
function modulesOf(projectDir: string): string[] {
  const out = existsSync(join(projectDir, 'node_modules')) ? ['node_modules'] : [];
  for (const e of readdirSync(projectDir, { withFileTypes: true })) {
    if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && existsSync(join(projectDir, e.name, 'node_modules'))) out.push(join(e.name, 'node_modules'));
  }
  return out;
}

const isLink = (path: string): boolean => { try { return lstatSync(path).isSymbolicLink(); } catch { return false; } };

/** Ish nusxasidagi node_modules ulanmalari (ildizda va bir qavat ichida), nusxaga nisbatan yo'li bilan */
function linkedModules(workDir: string): string[] {
  if (!existsSync(workDir)) return [];
  const candidates = ['node_modules', ...readdirSync(workDir, { withFileTypes: true }).filter(e => e.name !== 'node_modules' && e.name !== '.git').map(e => join(e.name, 'node_modules'))];
  return candidates.filter(rel => isLink(join(workDir, rel)));
}

/** Ish nusxasidagi node_modules ulanmalari (asl papkaga tegmasdan) uziladi. Uzilmagani qolsa — GitError: nusxani o'chirish xavfli */
export function unlinkModules(workDir: string): void {
  for (const rel of linkedModules(workDir)) {
    const path = join(workDir, rel);
    // Ulanmaning o'zi olinadi: rmdir/unlink ichidagi fayllarga tegmaydi (recursive o'chirish ISHLATILMAYDI)
    try { rmdirSync(path); } catch { try { unlinkSync(path); } catch { /* quyida tekshiriladi */ } }
    if (isLink(path)) throw new GitError(`node_modules ulanmasi uzilmadi: ${path} — ish nusxasi o'chirilmadi (asl papka o'chib ketmasin)`);
  }
}

/** Yangi ish nusxasi: loyihaning hozirgi commit'idan, o'z shoxida; node_modules ulanadi */
export async function prepare(projectDir: string, workRoot: string, jobId: string): Promise<Work> {
  const base = await git(projectDir, 'rev-parse', 'HEAD');
  const branch = `palantir/${jobId}`, dir = join(workRoot, jobId);
  mkdirSync(workRoot, { recursive: true });
  await git(projectDir, 'worktree', 'add', '-b', branch, dir, base);
  for (const rel of modulesOf(projectDir)) {
    const link = join(dir, rel);
    // Loyiha node_modules'ni git'da saqlasa (kamdan-kam) — nusxada bor, ulanmaydi
    if (existsSync(link) || !existsSync(join(dir, rel, '..'))) continue;
    try { symlinkSync(join(projectDir, rel), link, 'junction'); } catch (e) { console.warn('[dasturchi] node_modules ulanmadi:', (e as Error).message); }
  }
  return { dir, branch, base };
}

/** Ish nusxasida qolgan hamma o'zgarish commit qilinadi (model o'zi commit qilgan bo'lsa — faqat qolgani) */
export async function commitAll(w: Work, message: string): Promise<void> {
  await git(w.dir, 'add', '-A');
  // Ulanmalar commit'ga tushmasin: loyiha node_modules'ni .gitignore'ga yozmagan bo'lsa, git ularni ham qo'shadi
  for (const rel of linkedModules(w.dir)) await git(w.dir, 'reset', '-q', '--', rel.split(sep).join('/')).catch(() => {});
  const staged = await git(w.dir, 'diff', '--cached', '--name-only');
  if (staged) await git(w.dir, 'commit', '-m', message);
}

export interface Changes { files: string[]; added: number; removed: number }

/** Ish boshidan beri o'zgargan fayllar (commit qilingan) */
export async function changesOf(w: Work): Promise<Changes> {
  const out = await git(w.dir, 'diff', '--numstat', `${w.base}..HEAD`);
  const rows = out ? out.split('\n').map(l => l.split('\t')) : [];
  return { files: rows.map(r => r[2]), added: rows.reduce((n, r) => n + (Number(r[0]) || 0), 0), removed: rows.reduce((n, r) => n + (Number(r[1]) || 0), 0) };
}

/** O'zgarishlar bitta faylga (egasi Telegram'da ochib ko'radi) */
export async function writePatch(w: Work, file: string): Promise<void> {
  writeFileSync(file, `${await git(w.dir, 'diff', `${w.base}..HEAD`)}\n`);
}

/**
 * Qabul qilish: ish shoxi loyihaning hozirgi shoxiga qo'shiladi. Qo'shilmasa (loyihadagi saqlanmagan o'zgarish shu fayllarda yoki
 * to'qnashuv) — loyiha avvalgi holida qoladi va GitError
 */
export async function mergeInto(projectDir: string, w: Work, message: string): Promise<void> {
  // Egasining o'zi boshlagan, tugallanmagan merge bo'lsa — tegilmaydi: pastdagi «--abort» uning yechimlarini o'chirib yuborardi
  const merging = () => git(projectDir, 'rev-parse', '-q', '--verify', 'MERGE_HEAD').then(() => true, () => false);
  if (await merging()) throw new GitError('loyihada tugallanmagan merge bor (MERGE_HEAD)');
  try {
    await git(projectDir, 'merge', '--no-edit', '-m', message, w.branch);
  } catch (e) {
    // Faqat shu urinish boshlagan chala merge qaytariladi
    if (await merging()) await git(projectDir, 'merge', '--abort').catch(() => {});
    throw e;
  }
}

/** Ish nusxasida commit qilinmagan o'zgarish qolganmi (ulanmalar hisobga olinmaydi) */
export async function dirty(w: Work): Promise<boolean> {
  const out = await git(w.dir, 'status', '--porcelain');
  // Qator: «XY yo'l» (git() boshidagi bo'shliqni kesadi — holat belgisi bir yoki ikki harf bo'lib keladi)
  return out.split('\n').some(l => l.trim() && !/(^|\/)node_modules\/?$/.test(l.trim().replace(/^\S{1,2}\s+/, '').replace(/^"|"$/g, '')));
}

/** Ish nusxasi va (kerak bo'lsa) shoxi o'chiriladi. Avval ulanmalar uziladi */
export async function cleanup(projectDir: string, w: Work, dropBranch: boolean): Promise<void> {
  unlinkModules(w.dir);
  if (existsSync(w.dir)) await git(projectDir, 'worktree', 'remove', '--force', w.dir);
  await git(projectDir, 'worktree', 'prune').catch(() => {});
  if (dropBranch) await git(projectDir, 'branch', '-D', w.branch).catch(() => {});
}
