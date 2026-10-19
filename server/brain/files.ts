/**
 * Ikkinchi miya panelda — Obsidian kabi: papkalar daraxti, sahifani o'qish va tahrirlash, unga havola qilgan sahifalar.
 * Fayllar o'sha — Obsidian'da ham shu papka ochiladi; panelda saqlangan o'zgarish Obsidian'da darhol ko'rinadi va aksincha.
 * Faqat papka ichidagi .md fayllar: yo'l papkadan chiqib keta olmaydi (.., mutlaq yo'l, nuqtali papkalar — .obsidian, .trash).
 */
import { existsSync, readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { put, refresh, vaultDir } from './vault';

export interface TreeNode { name: string; path: string; kind: 'dir' | 'file'; children?: TreeNode[] }
export interface NoteView { path: string; content: string; modified: string; backlinks: { path: string; line: string }[] }

const MAX_FILES = 3000;
const MAX_DEPTH = 6;
export const MAX_NOTE = 200_000;
const MAX_BACKLINKS = 50;

export class NoteError extends Error {}

const visible = (d: Dirent) => !d.name.startsWith('.') && !d.isSymbolicLink() && (d.isDirectory() || (d.isFile() && d.name.toLowerCase().endsWith('.md')));
const byKind = (a: TreeNode, b: TreeNode) => (a.kind === b.kind ? a.name.localeCompare(b.name, 'uz') : a.kind === 'dir' ? -1 : 1);

/** Papkadagi bo'limlar va sahifalar (bo'sh papka ham ko'rinadi: Kutyapti) */
export function noteTree(bizId: string): TreeNode[] {
  const root = vaultDir(bizId);
  let count = 0;
  const walk = (rel: string, depth: number): TreeNode[] => {
    let list: Dirent[] = [];
    try { list = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return []; }
    const out: TreeNode[] = [];
    for (const d of list.filter(visible)) {
      if (count >= MAX_FILES) break;
      count++;
      const path = rel ? `${rel}/${d.name}` : d.name;
      if (d.isDirectory()) out.push({ name: d.name, path, kind: 'dir', children: depth < MAX_DEPTH ? walk(path, depth + 1) : [] });
      else out.push({ name: d.name.replace(/\.md$/i, ''), path, kind: 'file' });
    }
    return out.sort(byKind);
  };
  return walk('', 0);
}

/** Papka ichidagi .md fayl (to'liq yo'l); papkadan tashqari yoki boshqa tur — NoteError */
function safePath(bizId: string, rel: string): { root: string; full: string; rel: string } {
  const root = vaultDir(bizId);
  const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!clean || clean.split('/').some(seg => !seg || seg === '..' || seg.startsWith('.')) || !/\.md$/i.test(clean)) throw new NoteError("Sahifa nomi noto'g'ri");
  const full = resolve(root, clean);
  if (!full.startsWith(resolve(root) + sep)) throw new NoteError("Sahifa nomi noto'g'ri");
  return { root, full, rel: relative(root, full).split(sep).join('/') };
}

/** [[Nom]] havolalari shu sahifaga qaraydimi (nom fayl nomi, papkasiz yoki papkali, | va # dan oldin) */
function linksTo(text: string, rel: string): string | null {
  const base = rel.replace(/\.md$/i, '');
  const name = base.split('/').pop()!.toLowerCase();
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
    const target = m[1].trim().replace(/\.md$/i, '').toLowerCase();
    if (target === name || target === base.toLowerCase()) return m[0];
  }
  return null;
}

function allFiles(root: string, rel = '', depth = 0, out: string[] = []): string[] {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return out;
  let list: Dirent[] = [];
  try { list = readdirSync(join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const d of list.filter(visible)) {
    const path = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) allFiles(root, path, depth + 1, out);
    else out.push(path);
  }
  return out;
}

export function readNote(bizId: string, rel: string): NoteView {
  const { root, full, rel: path } = safePath(bizId, rel);
  if (!existsSync(full)) throw new NoteError('Sahifa topilmadi');
  const raw = readFileSync(full, 'utf8');
  const content = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const backlinks: NoteView['backlinks'] = [];
  for (const other of allFiles(root)) {
    if (other === path || backlinks.length >= MAX_BACKLINKS) continue;
    let text = '';
    try { text = readFileSync(join(root, other), 'utf8'); } catch { continue; }
    if (!linksTo(text, path)) continue;
    const line = text.split(/\r?\n/).find(l => linksTo(l, path)) ?? '';
    backlinks.push({ path: other, line: line.trim().slice(0, 200) });
  }
  return { path, content, modified: statSync(full).mtime.toISOString(), backlinks };
}

/** Sahifani saqlaydi (yangi bo'lsa — yaratadi); mundarija va AI bilimi yangilanadi */
export function writeNote(bizId: string, rel: string, content: string): NoteView {
  const { root, rel: path } = safePath(bizId, rel);
  if (content.length > MAX_NOTE) throw new NoteError('Sahifa juda katta');
  put(root, path, content);
  refresh(bizId);
  return readNote(bizId, path);
}
