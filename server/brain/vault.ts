/**
 * Ikkinchi miya — papka. Bilim bazada emas, oddiy Markdown fayllarda turadi; Obsidian shu papkani «vault» sifatida ochadi.
 *
 *   INDEKS.md, Narxlar.md     Cerebro yozadi: mundarija va profildagi narxlar nusxasi (qo'lda o'zgartirilgani saqlanmaydi)
 *   QOIDALAR.md               papka qanday tuzilgani (bir marta yoziladi, egasi o'zgartirishi mumkin)
 *   Bilim/Faktlar.md          har qator — bitta fakt
 *   Bilim/Uslub.md            mijozlarga qanday yozish
 *   Bilim/Savollar/*.md       tasdiqlangan savol-javoblar: sarlavha — savol, matn — javob
 *   Bilim/Tuzatishlar/*.md    egasi «o'rgan» degan tuzatishlar
 *   Bilim/Namunalar/*.md      hujjat namunalari
 *   Bilim/ ichidagi boshqa .md  egasi o'zi yozgan sahifalar
 *   Kutyapti/*.md             egasining tasdig'ini kutayotganlar — mijozlarga javobda ishlatilmaydi
 *   Hujjatlar/*.md            yordamchi tayyorlagan hujjatlar nusxasi — bilim emas, hech qaysi modelga o'qib berilmaydi
 *   Manbalar/*                egasi suhbatga tashlagan fayllarning asli (PDF, Word, Excel) — o'qilgan matni Kutyapti'ga taklif bo'lib tushadi
 *
 * Holat papkadan bilinadi: faylni Kutyapti'dan Bilim/Savollar'ga ko'chirish — tasdiqlash. Fayl boshidagi xossalardan faqat
 * id, tur, manba va sana o'qiladi; egasi qo'shgan boshqa xossalar (teglar va h.k.) o'zgarishsiz qoladi.
 * Hisob-kitob (narxlar, qabullar, to'lovlar) bazada va CRM'da qoladi — bu yerda bilim turadi.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, type Dirent } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Knowledge, KnowledgeKind, Note } from '../../src/types';
import { businesses, knowledge as tableKnowledge, newId, notes as tableNotes, type BusinessRow } from '../db';
import { env } from '../env';
import { inert } from './logic';

const ACTIVE = 'Bilim', WAITING = 'Kutyapti', DOCS = 'Hujjatlar', SOURCES = 'Manbalar';
/** Bazadagi yozuvlarning ko'rinishi (mirror.ts yozadi): vazifalar ro'yxati va telefon suhbatlari — bilim emas, modelga mijoz javobi uchun berilmaydi */
export const TASKS_FILE = 'Vazifalar.md', CALLS = "Qo'ng'iroqlar";
/** Telefondagi AI qanday gaplashadi (salomlashish, ohang, ovoz) — egasi yoki o'rnatuvchi har biznesga moslaydi; bilim emas */
export const PHONE_FILE = 'Telefon.md';
/** Fayldan kelgan yozuvning manbasi shu belgi bilan boshlanadi: `fayl:<Manbalar ichidagi yo'l>` */
export const FILE_SOURCE = 'fayl:';
/** Mundarijada shuncha oxirgi hujjat ko'rsatiladi (qolgani papkaning o'zida) */
const MAX_DOC_LINKS = 30;
const FOLDER: Partial<Record<KnowledgeKind, string>> = { qa: 'Savollar', fix: 'Tuzatishlar', sample: 'Namunalar' };
const KIND_WORD: Record<KnowledgeKind, string> = { qa: 'savol', fix: 'tuzatish', sample: 'namuna', page: 'sahifa' };
const FACTS = `${ACTIVE}/Faktlar.md`, STYLE = `${ACTIVE}/Uslub.md`, ABOUT = `${ACTIVE}/Biznes haqida.md`;
/** Obsidian izohi (%% ... %%): egasiga ko'rsatma, modelga berilmaydi. «10%% dan 20%% gacha» kabi oddiy matn izoh emas */
export const COMMENT = /(?<![\p{L}\p{N}%])%%[\s\S]*?%%(?![\p{L}\p{N}%])/gu;
const GENERATED = "> Bu sahifani Cerebro yozadi. Qo'lda o'zgartirsangiz, keyingi yangilanishda ustidan yoziladi.";
const DRAFT_HEADING = '## Cerebro yozgan', SENT_HEADING = '## Egasi yuborgan';
/** Bundan katta fayl o'qilmaydi (adashib tashlangan kitob butun so'rovni to'ldirib yubormasin) */
const MAX_FILE_BYTES = 200_000;
const MAX_NAME = 80;

interface Entry extends Knowledge { file: string }

// ─── Papka va fayl nomlari ───────────────────────────────────────────────────

/** Login — o'qish uchun, id — takrorlanmasligi uchun: ikki biznesning papkasi hech qachon bitta bo'lib qolmaydi */
const folderName = (biz: BusinessRow): string => `${biz.login.replace(/[^a-z0-9_-]/g, '') || 'biznes'}-${biz.id.replace(/[^A-Za-z0-9]/g, '')}`;
const pathId = (rel: string): string => createHash('sha1').update(rel).digest('hex').slice(0, 10);
/** Fayl matni, boshidagi BOM belgisisiz (Windows muharrirlari qo'shadi) */
const load = (full: string): string => { const t = readFileSync(full, 'utf8'); return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t; };

/** Biznesning papkasi (DATA_DIR ichida). Birinchi murojaatda yaratiladi va bazadagi eski bilim fayllarga o'tkaziladi */
export function vaultDir(bizId: string): string {
  const biz = businesses.byId(bizId);
  if (!biz) throw new Error('Biznes topilmadi');
  const dir = join(env.dataDir, 'miya', folderName(biz));
  if (!existsSync(dir)) create(biz, dir);
  // «Biznes haqida» har papkaga bir marta yoziladi — bu sahifa paydo bo'lishidan oldin yaratilgan papkalarga ham
  // (aks holda profildagi manzil va ish vaqti hech qayerda qolmaydi). Egasi keyin o'chirsa — qaytarilmaydi
  const seeded = `${dir}.haqida`;
  if (!existsSync(seeded)) {
    // O'qish yo'lida turgani uchun: yozib bo'lmasa (fayl band) bilim baribir o'qiladi, keyingi safar yana uriniladi
    try {
      if (!existsSync(join(dir, ABOUT))) put(dir, ABOUT, about(biz));
      writeFileSync(seeded, new Date().toISOString());
    } catch (err) {
      console.error('[miya] «Biznes haqida» yozilmadi:', (err as Error).message);
    }
  }
  // Telefon sahifasi ham bir marta: egasi o'chirsa — qaytarilmaydi (telefondagi AI unda ham standart gaplashadi)
  const phoneSeeded = `${dir}.telefon`;
  if (!existsSync(phoneSeeded)) {
    try {
      if (!existsSync(join(dir, PHONE_FILE))) put(dir, PHONE_FILE, phonePage());
      writeFileSync(phoneSeeded, new Date().toISOString());
    } catch (err) {
      console.error('[miya] «Telefon» yozilmadi:', (err as Error).message);
    }
  }
  return dir;
}

/** Panel va hujjatlar uchun: DATA_DIR ga nisbatan yo'l */
export const vaultPath = (bizId: string): string => { const biz = businesses.byId(bizId); return biz ? `miya/${folderName(biz)}` : ''; };

/** Fayl nomi: Windows va Obsidian qabul qilmaydigan belgilarsiz */
function fileName(title: string, id: string): string {
  const clean = title.replace(/[\\/:*?"<>|#^[\]\p{Cc}\p{Cf}]+/gu, ' ').replace(/\s+/g, ' ').trim().replace(/^[. ]+/, '').slice(0, MAX_NAME).replace(/[. ]+$/, '');
  // Windows «AUX», «CON.txt», «Aux. narx» kabi nomlarni qurilma deb biladi — nuqtagacha bo'lgan qismi tekshiriladi
  return !clean || /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean.split('.')[0].trim()) ? `Yozuv ${id}` : clean;
}

export function put(root: string, rel: string, content: string): void {
  const full = join(root, rel);
  mkdirSync(dirname(full), { recursive: true });
  // Mazmuni o'zgarmagan fayl qayta yozilmaydi: Obsidian'da ochiq sahifa bekorga «o'zgardi» deb yangilanmasin
  if (existsSync(full) && load(full) === content) return;
  writeFileSync(full, content);
}

/** Papkadagi hamma .md fayllar (nisbiy yo'l, «/» bilan). Nuqtali papkalar (.obsidian, .trash) va havolalar o'qilmaydi */
function walk(root: string, rel = ''): string[] {
  const here = join(root, rel);
  let list: Dirent[] = [];
  // O'qib bo'lmagan papka (ruxsat yo'q, shu payt o'chirilgan) qolganini to'xtatmaydi
  try { list = readdirSync(here, { withFileTypes: true }); } catch { return []; }
  return list.flatMap(d => {
    if (d.name.startsWith('.') || d.isSymbolicLink()) return [];
    const next = rel ? `${rel}/${d.name}` : d.name;
    return d.isDirectory() ? walk(root, next) : d.isFile() && d.name.toLowerCase().endsWith('.md') ? [next] : [];
  });
}

// ─── Fayl ↔ yozuv ────────────────────────────────────────────────────────────

/** Fayl boshidagi xossalar bloki: bizga kerakli to'rtta kalit o'qiladi, qolgan qatorlar o'zgarishsiz saqlanadi */
function split(text: string): { props: string[]; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return m ? { props: m[1].split(/\r?\n/), body: text.slice(m[0].length) } : { props: [], body: text };
}
const prop = (props: string[], key: string): string => {
  const line = props.find(l => l.startsWith(`${key}:`));
  return line ? line.slice(key.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2') : '';
};
/** Xossa qiymati bir qatorda va YAML'ni buzmaydigan ko'rinishda */
const value = (v: string): string => (/^[A-Za-z0-9_.:+-]+$/.test(v) ? v : JSON.stringify(v));
function withProps(props: string[], set: Record<string, string>): string[] {
  const kept = props.filter(l => !Object.keys(set).some(k => l.startsWith(`${k}:`)));
  return [...Object.entries(set).map(([k, v]) => `${k}: ${value(v)}`), ...kept];
}

function titled(body: string, fallback: string): { title: string; rest: string } {
  const m = /^\s*#\s+(.+?)\s*(?:\r?\n|$)/.exec(body);
  return m ? { title: m[1].trim(), rest: body.slice(m[0].length).trim() } : { title: fallback, rest: body.trim() };
}

function read(root: string, rel: string): Entry | null {
  const parts = rel.split('/');
  const status = parts[0] === WAITING ? 'suggested' : parts[0] === ACTIVE ? 'active' : null;
  if (!status || rel === FACTS || rel === STYLE) return null;
  const full = join(root, rel);
  const stat = statSync(full);
  if (stat.size > MAX_FILE_BYTES) return null;
  const { props, body } = split(load(full));
  const byFolder = Object.entries(FOLDER).find(([, folder]) => parts.length === 3 && parts[1] === folder)?.[0] as KnowledgeKind | undefined;
  // «tur: tuzatish» papkadan ustun: tuzatish fayli Bilim/Savollar'ga ko'chirilsa ham savol-javobga aylanib, hamma mijozga ketib qolmaydi
  // Kutyapti'dagi fayl odatda savol-javob taklifi; fayldan kelgan sahifa taklifi «tur: sahifa» yoki manbasi (fayl:…) bilan tanilad —
  // egasi Obsidian'da «tur» qatorini o'chirib qo'ysa ham butun hujjat bitta savolning javobiga aylanib qolmaydi
  const tur = prop(props, 'tur');
  const filed = tur === KIND_WORD.page || prop(props, 'manba').startsWith(FILE_SOURCE);
  const kind: KnowledgeKind = tur === KIND_WORD.fix ? 'fix' : status === 'suggested' ? (filed ? 'page' : 'qa') : byFolder ?? 'page';
  const { title, rest } = titled(body, parts.at(-1)!.replace(/\.md$/i, ''));
  const id = /^[A-Za-z0-9_-]{4,40}$/.test(prop(props, 'id')) ? prop(props, 'id') : pathId(rel);
  const at = Date.parse(prop(props, 'sana'));
  const common = { id, kind, status, source: prop(props, 'manba') || 'owner', createdAt: new Date(Number.isNaN(at) ? stat.birthtimeMs || stat.mtimeMs : at).toISOString(), file: rel } as const;
  if (kind === 'page') return { ...common, question: title, answer: rest.replace(COMMENT, '').trim() };
  if (kind !== 'fix') return rest ? { ...common, question: title, answer: rest } : null;
  const draftAt = body.indexOf(DRAFT_HEADING), sentAt = body.indexOf(SENT_HEADING);
  // Ikki bo'limi bo'lmagan «tuzatish» — tuzatish emas (egasi qo'lda buzib qo'ygan): hech narsa o'rganilmaydi
  if (draftAt < 0 || sentAt < draftAt) return null;
  return { ...common, question: body.slice(draftAt + DRAFT_HEADING.length, sentAt).trim(), answer: body.slice(sentAt + SENT_HEADING.length).trim() };
}

const unreadable = new Set<string>();
function entriesIn(root: string): Entry[] {
  const seen = new Set<string>();
  return walk(root).sort().flatMap(rel => {
    try {
      const e = read(root, rel);
      if (!e) return [];
      // Nusxasi ko'chirilgan faylda id takrorlanadi: ikkinchisi o'z yo'lidan belgi oladi — biri o'zgartirilganda boshqasiga tegilmaydi
      const unique = seen.has(e.id) ? { ...e, id: pathId(rel) } : e;
      seen.add(unique.id);
      return [unique];
    } catch (err) {
      // O'qilmagan bitta fayl (band, shu payt o'chirilgan) butun bilimni yiqitmaydi
      if (!unreadable.has(rel)) { unreadable.add(rel); console.error(`[miya] fayl o'qilmadi (${rel}):`, (err as Error).message); }
      return [];
    }
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}
const entries = (bizId: string): Entry[] => entriesIn(vaultDir(bizId));

function content(k: Knowledge, oldProps: string[] = []): string {
  const props = withProps(oldProps, { id: k.id, tur: KIND_WORD[k.kind], manba: k.source, sana: k.createdAt });
  const body = k.kind === 'fix' ? `# Tuzatish\n\n${DRAFT_HEADING}\n${k.question}\n\n${SENT_HEADING}\n${k.answer}` : `# ${k.question}\n\n${k.answer}`;
  return `---\n${props.join('\n')}\n---\n${body}\n`;
}

/** Yozuv turadigan joy. Egasi yozgan sahifa o'z joyida qoladi; boshqa yozuvning nomi band bo'lsa — id qo'shiladi */
function place(root: string, k: Knowledge, previous?: Entry): string {
  const current = previous?.file;
  // Egasi yozgan sahifa o'z joyida qoladi. Fayldan kelgan sahifa taklifi tasdiqlanganda Kutyapti'dan Bilim'ga ko'chadi
  if (k.kind === 'page' && current && (k.status === 'suggested') === current.startsWith(`${WAITING}/`)) return current;
  const folder = k.status === 'suggested' ? WAITING : `${ACTIVE}/${FOLDER[k.kind] ?? ''}`.replace(/\/$/, '');
  // Savoli va joyi o'zgarmagan fayl nomiga tegilmaydi: egasi uni o'zicha nomlagan bo'lsa, Obsidian'dagi havolalar uzilmasin
  if (previous && current && previous.question === k.question && current.slice(0, current.lastIndexOf('/')) === folder) return current;
  const name = k.kind === 'fix' ? `Tuzatish ${k.id}` : fileName(k.question, k.id);
  // Faktlar.md va Uslub.md — alohida ma'noli fayllar: shu nomli sahifa ularning o'rniga yozilmaydi
  const taken = (rel: string) => rel !== current && (existsSync(join(root, rel)) || [FACTS, STYLE].some(s => s.toLowerCase() === rel.toLowerCase()));
  const plain = `${folder}/${name}.md`, marked = `${folder}/${name} ${k.id.slice(0, 4)}.md`;
  return !taken(plain) ? plain : !taken(marked) ? marked : `${folder}/${name} ${k.id}.md`;
}

function save(root: string, k: Knowledge, previous?: Entry): Entry {
  const file = place(root, k, previous);
  const oldProps = previous ? split(load(join(root, previous.file))).props : [];
  put(root, file, content(k, oldProps));
  if (previous && previous.file !== file) rmSync(join(root, previous.file), { force: true });
  return { ...k, file };
}

const bare = ({ file: _file, ...k }: Entry): Knowledge => k;

// ─── Savol-javoblar, tuzatishlar, namunalar, sahifalar ───────────────────────

export const vault = {
  add(bizId: string, k: Omit<Knowledge, 'id' | 'createdAt'>): Knowledge {
    const saved = save(vaultDir(bizId), { ...k, id: newId(10), createdAt: new Date().toISOString() });
    refresh(bizId);
    return bare(saved);
  },
  get(bizId: string, id: string): Knowledge | null {
    const hit = entries(bizId).find(e => e.id === id);
    return hit ? bare(hit) : null;
  },
  list: (bizId: string, kind?: KnowledgeKind): Knowledge[] => entries(bizId).filter(e => !kind || e.kind === kind).map(bare),
  update(bizId: string, id: string, patch: Partial<Pick<Knowledge, 'question' | 'answer' | 'status'>>): Knowledge | null {
    const old = entries(bizId).find(e => e.id === id);
    if (!old) return null;
    const saved = save(vaultDir(bizId), { ...bare(old), ...patch }, old);
    refresh(bizId);
    return bare(saved);
  },
  remove(bizId: string, id: string): boolean {
    const old = entries(bizId).find(e => e.id === id);
    if (!old) return false;
    rmSync(join(vaultDir(bizId), old.file), { force: true });
    refresh(bizId);
    return true;
  },
  /** Shu turdagi eng yangi `keep` tasi qoladi */
  trim(bizId: string, kind: KnowledgeKind, keep: number): void {
    const extra = entries(bizId).filter(e => e.kind === kind).reverse().slice(keep);
    for (const e of extra) rmSync(join(vaultDir(bizId), e.file), { force: true });
    if (extra.length) refresh(bizId);
  },
  /** Egasi javob bermagan eski takliflar o'chadi */
  expireSuggested(bizId: string, beforeIso: string): void {
    const old = entries(bizId).filter(e => e.status === 'suggested' && e.createdAt < beforeIso);
    for (const e of old) {
      rmSync(join(vaultDir(bizId), e.file), { force: true });
      // Fayldan kelgan taklif eskirdi — faylning asli ham qolmaydi
      if (e.source.startsWith(FILE_SOURCE)) removeSource(bizId, e.source.slice(FILE_SOURCE.length));
    }
    if (old.length) refresh(bizId);
  },
};

/**
 * Yordamchi tayyorlagan hujjatning nusxasi papkaga tushadi: egasi uni Obsidian'da ko'radi va qidiradi.
 * Bu bilim emas — read() faqat Bilim va Kutyapti'ni o'qiydi, shuning uchun hujjatdagi ism va summalar hech qaysi modelga qaytib bormaydi.
 * Nusxa yozilmasa (fayl band), hujjatning o'zi baribir tayyor: xato yuqoriga chiqmaydi.
 */
export function mirrorDocument(bizId: string, doc: { id: string; title: string; markdown: string; createdAt: string }): void {
  try {
    const root = vaultDir(bizId);
    const name = `${DOCS}/${doc.createdAt.slice(0, 10)} ${fileName(doc.title, doc.id)}`;
    const rel = existsSync(join(root, `${name}.md`)) ? `${name} ${doc.id.slice(0, 6)}.md` : `${name}.md`;
    // Hujjatni model yozgan (mijozlar yozishmasidan ham foydalanishi mumkin) — rasm havolasi va HTML zararsizlantiriladi
    const text = inert(doc.markdown.trim());
    put(root, rel, `---\nid: ${value(doc.id)}\ntur: hujjat\nsana: ${value(doc.createdAt)}\n---\n${/^#\s/.test(text) ? '' : `# ${inert(doc.title.replace(/\s+/g, ' ').trim())}\n\n`}${text}\n`);
    refresh(bizId);
  } catch (err) {
    console.error('[miya] hujjat nusxasi yozilmadi:', (err as Error).message);
  }
}

export type SourceExt = 'pdf' | 'docx' | 'xlsx' | 'txt' | 'csv';
/** Bir biznesning Manbalar/ bo'limi shundan oshmaydi (disk to'lib, butun server to'xtab qolmasin) */
const MAX_SOURCES_BYTES = 300 * 1024 * 1024;
export class SourcesFullError extends Error {}
/** Papkadagi fayllar hajmi (ichki papkalarsiz; papka yo'q bo'lsa — bo'sh) */
function walkAll(dir: string): { size: number }[] {
  try { return readdirSync(dir, { withFileTypes: true }).filter(d => d.isFile()).map(d => ({ size: statSync(join(dir, d.name)).size })); } catch { return []; }
}

/**
 * Egasi tashlagan faylning asli papkada saqlanadi (Manbalar/): Obsidian'da ko'rinadi, hech qaysi modelga o'qib berilmaydi.
 * Nomi sarlavhadan yasaladi (fayl tizimiga yaroqsiz belgilarsiz), kengaytma — mazmundan aniqlangan tur. Qaytadi: papkaga nisbatan yo'l.
 */
export function saveSource(bizId: string, title: string, ext: SourceExt, bytes: Buffer): string {
  const root = vaultDir(bizId);
  const used = walkAll(join(root, SOURCES)).reduce((sum, f) => sum + f.size, 0);
  if (used + bytes.length > MAX_SOURCES_BYTES) throw new SourcesFullError(`Fayllar uchun ajratilgan joy to'ldi (${MAX_SOURCES_BYTES / 1024 / 1024} MB). Papkaning «Manbalar» bo'limidan keraksiz fayllarni o'chiring.`);
  const id = newId(6);
  const base = `${SOURCES}/${new Date().toISOString().slice(0, 10)} ${fileName(title, id)}`;
  const rel = existsSync(join(root, `${base}.${ext}`)) ? `${base} ${id}.${ext}` : `${base}.${ext}`;
  mkdirSync(join(root, SOURCES), { recursive: true });
  writeFileSync(join(root, rel), bytes);
  return rel;
}

/** Rad etilgan faylning asli o'chadi. Yo'l fayl xossasidan keladi (egasi tahrirlashi mumkin) — faqat Manbalar ichidagi bitta fayl qabul qilinadi */
export function removeSource(bizId: string, rel: string): void {
  if (!/^Manbalar\/(?!\.{1,2}$)[^/\\]+$/.test(rel)) return;
  try { rmSync(join(vaultDir(bizId), rel), { force: true }); } catch (err) { console.error('[miya] fayl asli o\'chirilmadi:', (err as Error).message); }
}

// ─── Faktlar va uslub ────────────────────────────────────────────────────────

const FACT_LINE = /^\s*[-*]\s+(.+?)(?:\s+\^([A-Za-z0-9-]+))?\s*$/;
/** Bitta fakt so'rovlarga shundan uzun bo'lib tushmaydi */
const MAX_FACT = 500;
const factId = (text: string, given?: string): string => given ?? createHash('sha1').update(text).digest('hex').slice(0, 8);

/** Yagona fayl (Faktlar.md, Uslub.md): o'qilmasa yoki haddan katta bo'lsa — null. Bitta band fayl butun bilimni yiqitmaydi */
function safeLoad(full: string): string | null {
  try {
    if (!existsSync(full)) return '';
    return statSync(full).size > MAX_FILE_BYTES ? null : load(full);
  } catch (err) {
    if (!unreadable.has(full)) { unreadable.add(full); console.error(`[miya] fayl o'qilmadi (${full}):`, (err as Error).message); }
    return null;
  }
}
/** Faktlar faylining qatorlari. Yozishdan oldin: fayl o'qilmagan bo'lsa ustidan yozilmaydi (ichidagisi yo'qolmasin) */
function factLinesIn(root: string, forWrite = false): string[] {
  const text = safeLoad(join(root, FACTS));
  if (text === null && forWrite) throw new Error("Faktlar.md ni o'qib bo'lmadi — faylni tekshiring");
  return text ? text.split(/\r?\n/) : [];
}
interface FactRow { id: string; text: string; line: number }
function factRows(lines: string[]): FactRow[] {
  // Fayl boshidagi xossalar bloki (teglar ro'yxati ham «- » bilan boshlanadi) fakt emas
  const start = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') + 1 : 0;
  const seen = new Set<string>();
  return lines.flatMap((l, line) => {
    const m = line >= start ? FACT_LINE.exec(l) : null;
    if (!m) return [];
    const own = factId(m[1], m[2]);
    // Nusxasi ko'chirilgan qator (belgisi yoki matni bir xil): ikkinchisi o'rnidan belgi oladi — bittasi o'chirilganda ikkalasi ketmaydi
    const id = seen.has(own) ? factId(`${m[1]}#${line}`) : own;
    seen.add(id);
    return [{ id, text: m[1].slice(0, MAX_FACT), line }];
  });
}
const factCount = (root: string): number => factRows(factLinesIn(root)).length;

/** Faktlar — Bilim/Faktlar.md dagi ro'yxat qatorlari. Egasi Obsidian'da qo'shgan qator ham fakt (belgisi matnidan hisoblanadi) */
export const facts = {
  list(bizId: string): Note[] {
    const root = vaultDir(bizId);
    const at = new Date().toISOString();
    return factRows(factLinesIn(root)).map(r => ({ id: r.id, text: r.text, createdAt: at }));
  },
  add(bizId: string, text: string): Note {
    const note = { id: newId(8), text: text.replace(/\s+/g, ' ').trim(), createdAt: new Date().toISOString() };
    const lines = factLinesIn(vaultDir(bizId), true);
    const head = lines.length ? lines : ['# Faktlar', '', 'Har qator — bitta fakt. Cerebro ularni hujjat va javoblarda ishlatadi.', ''];
    const before = head.join('\n').trimEnd();
    // Ro'yxatning birinchi qatori sarlavha matnidan bo'sh qator bilan ajraladi
    put(vaultDir(bizId), FACTS, `${before}${FACT_LINE.test(before.split('\n').at(-1) ?? '') ? '\n' : '\n\n'}- ${note.text} ^${note.id}\n`);
    refresh(bizId);
    return note;
  },
  remove(bizId: string, id: string): boolean {
    const lines = factLinesIn(vaultDir(bizId), true);
    const hit = factRows(lines).find(r => r.id === id);
    if (!hit) return false;
    put(vaultDir(bizId), FACTS, lines.filter((_, n) => n !== hit.line).join('\n'));
    refresh(bizId);
    return true;
  },
};

export const style = {
  get(bizId: string): string {
    return titled(split(safeLoad(join(vaultDir(bizId), STYLE)) ?? '').body, '').rest;
  },
  /** Egasi faylga qo'shgan xossalar (teglar) saqlanadi */
  set(bizId: string, text: string): void {
    const { props } = split(safeLoad(join(vaultDir(bizId), STYLE)) ?? '');
    put(vaultDir(bizId), STYLE, `${props.length ? `---\n${props.join('\n')}\n---\n` : ''}# Uslub\n\n${text.trim()}\n`);
  },
};

// ─── Cerebro yozadigan sahifalar ─────────────────────────────────────────────

const link = (file: string, label: string): string => `[[${file.replace(/\.md$/i, '')}|${label.replace(/[[\]|]/g, ' ').slice(0, 120)}]]`;

/** Mundarija va narxlar nusxasini yangilaydi (o'zgargan bo'lsagina yoziladi) */
export function refresh(bizId: string): void {
  // Mundarija — hosila: yozib bo'lmasa (fayl band), asosiy ish muvaffaqiyatsiz bo'lib chiqmaydi
  try {
    const biz = businesses.byId(bizId);
    if (biz) rebuild(biz, vaultDir(bizId));
  } catch (err) {
    console.error('[miya] mundarija yangilanmadi:', (err as Error).message);
  }
}

function rebuild(biz: BusinessRow, root: string): void {
  const all = entriesIn(root);
  const section = (title: string, list: Entry[]) => (list.length ? [`## ${title} (${list.length})`, ...list.map(e => `- ${link(e.file, e.kind === 'fix' ? e.answer : e.question)}`), ''] : []);
  const active = (kind: KnowledgeKind) => all.filter(e => e.kind === kind && e.status === 'active');
  // Nomi sanadan boshlanadi — yangisi yuqorida
  const docs = walk(root, DOCS).sort().reverse();
  const calls = walk(root, CALLS).sort().reverse();
  put(root, 'INDEKS.md', [
    `# ${biz.profile.name} — ikkinchi miya`, '', GENERATED, '',
    `- ${link('Narxlar.md', 'Narxlar')} — ${biz.profile.offerings.length} ta xizmat`,
    // Hali yozilmagan faylga havola qo'yilmaydi (Obsidian uni «uzilgan havola» deb ko'rsatadi)
    ...(existsSync(join(root, FACTS)) ? [`- ${link(FACTS, 'Faktlar')} — ${factCount(root)} ta`] : []),
    ...(existsSync(join(root, STYLE)) ? [`- ${link(STYLE, 'Uslub')}`] : []),
    ...(existsSync(join(root, TASKS_FILE)) ? [`- ${link(TASKS_FILE, 'Vazifalar')}`] : []),
    ...(existsSync(join(root, PHONE_FILE)) ? [`- ${link(PHONE_FILE, 'Telefon')} — telefondagi AI qanday gaplashadi`] : []),
    `- ${link('QOIDALAR.md', 'Bu papka qanday tuzilgan')}`, '',
    ...section("Tasdig'ingizni kutyapti", all.filter(e => e.status === 'suggested')),
    ...section('Savol-javoblar', active('qa')),
    ...section('Sizning sahifalaringiz', active('page')),
    ...section('Tuzatishlar', active('fix')),
    ...section('Hujjat namunalari', active('sample')),
    ...(docs.length ? [`## Hujjatlar (${docs.length})`, ...docs.slice(0, MAX_DOC_LINKS).map(f => `- ${link(f, f.slice(DOCS.length + 1).replace(/\.md$/i, ''))}`), ''] : []),
    ...(calls.length ? [`## Qo'ng'iroqlar (${calls.length})`, ...calls.slice(0, MAX_DOC_LINKS).map(f => `- ${link(f, f.slice(CALLS.length + 1).replace(/\.md$/i, ''))}`), ''] : []),
  ].join('\n'));
  const priced = biz.profile.offerings.map(o => `| ${o.name.replace(/\|/g, '/')} | ${o.price ? o.price.toLocaleString('ru').replace(/\s/g, ' ') : '—'} |`);
  put(root, 'Narxlar.md', [
    '# Narxlar', '', "> Bu sahifani Cerebro narxlar jadvalidan yozadi (panel → «Ikkinchi miya» → Narxlar, yoki yordamchiga ayting). Bu yerda o'zgartirilgani saqlanmaydi.", '',
    ...(priced.length ? ["| Xizmat | Narx (so'm) |", '|---|---|', ...priced] : ['Hali kiritilmagan.']), '',
  ].join('\n'));
}

const RULES = `# Bu papka qanday tuzilgan

Bu — Cerebro'ning ikkinchi miyasi: biznes haqida bilgan hamma narsasi shu fayllarda. Papkani Obsidian'da oching («Open folder as vault»).

- **Bilim/** — tasdiqlangan bilim. Cerebro mijozlarga faqat shu yerdagi narsadan javob beradi.
  - **Savollar/** — har fayl bitta savol: sarlavha — savol, matn — javob.
  - **Faktlar.md** — har qator bitta fakt. **Uslub.md** — mijozlarga qanday yozish.
  - **Tuzatishlar/**, **Namunalar/** — tuzatishlaringiz va hujjat namunalari.
  - Bilim ichida o'zingiz ochgan istalgan sahifa ham o'qiladi (masalan, «Implant.md»).
- **Kutyapti/** — sizning tasdig'ingizni kutayotganlar. Mijozlarga aytilmaydi. Savolni **Bilim/Savollar** ga (tuzatishni — **Bilim/Tuzatishlar** ga) ko'chirsangiz — tasdiqlangan bo'ladi; o'chirsangiz — rad etilgan.
- **Manbalar/** — siz suhbatga tashlagan fayllarning asli (PDF, Word, Excel). O'qilgan matni **Kutyapti**'ga tushadi va tasdig'ingizni kutadi.
- **Hujjatlar/** — yordamchi tayyorlagan shartnoma, taklif va xatlar nusxasi. Bu bilim emas: mijozlarga javobda ishlatilmaydi. Word fayli — panelda («Ikkinchi miya» → Hujjatlar).
- **Vazifalar.md** — vazifa va eslatmalar. Katakchani belgilasangiz — bajarildi, \`[-]\` — bekor; nom yoki vaqtni (📅) o'zgartirsangiz — Cerebro'da ham o'zgaradi; yangi qator \`- [ ] Nima qilish 2026-10-20 15:00\` — yangi vazifa.
- **Qo'ng'iroqlar/** — telefon suhbatlari: nima qilindi va suhbat matni.
- **Telefon.md** — telefondagi AI qanday gaplashadi: salomlashish, murojaat, ohang, ovoz (\`ovoz: standart\` yoki Gemini ovozi nomi). O'zgartirsangiz — keyingi qo'ng'iroqdan.
- **INDEKS.md**, **Narxlar.md** — Cerebro o'zi yozadi; qo'lda o'zgartirmang.

Narxlar, qabullar va to'lovlar bu yerda emas — ular panelda va CRM'da.
`;

/** «Biznes haqida» sahifasi: manzil, ish vaqti, telefon — endi profil formasida emas, shu yerda. Eski profil maydonlaridan bir marta yoziladi */
function about(biz: BusinessRow | null): string {
  const p = biz?.profile;
  const contacts = p ? [p.phone && `- Telefon: ${p.phone}`, p.address && `- Manzil: ${p.address}`, p.hours && `- Ish vaqti: ${p.hours}`, p.instagram && `- Instagram: ${p.instagram}`, p.website && `- Sayt: ${p.website}`].filter(Boolean) : [];
  const team = (p?.team ?? []).map(m => `- ${m.name} — ${m.role}${m.years ? `, ${m.years} yil tajriba` : ''}`);
  const body = [p?.description?.trim(), contacts.join('\n'), team.length ? `## Jamoa\n${team.join('\n')}` : ''].filter(Boolean).join('\n\n');
  return `# Biznes haqida\n\n${body || '%% Shu yerga yozing: manzil, ish vaqti, telefon, kimlar ishlaydi. Cerebro mijozlarga shu sahifadan javob beradi. %%'}\n`;
}

/** «Telefon» sahifasi: telefondagi AI uchun standart ko'rsatma — o'rnatuvchi klinikaga qarab o'zgartiradi */
function phonePage(): string {
  return `# Telefon

%% Telefondagi AI (Telegram qo'ng'irog'i) shu sahifaga qarab gaplashadi: salomlashish, murojaat, ohang, nima qilsin va nima qilmasin.
O'zgartirsangiz — keyingi qo'ng'iroqdan kuchga kiradi. «ovoz:» qatori — «standart» (o'zbekchani eng tabiiy aytadi), Gemini ovozi nomi (Kore, Aoede, Puck, Leda, Orus...)
yoki «voicelab:Madina» — AI gapini VoiceLab'ning o'zbek ovozi o'qiydi (tabiiyroq, lekin har gapga ~1 s va pul qo'shiladi).
{ism} — egasining profildagi ismi (qo'ng'iroq paytida qo'yiladi); «Ulug'bek aka» kabi aniq murojaatni o'zingiz ham yozishingiz mumkin.
Bu izoh AI'ga berilmaydi. %%

ovoz: standart

## Murojaat
Egasiga ismi bilan, hurmat bilan murojaat qil: {ism}.

## Salomlashish
Assalomu alaykum, {ism}! Cerebro eshitadi.

## Qanday gaplashsin
- Iliq va hurmat bilan, xuddi tajribali yordamchi kabi.
- Qisqa: bir-ikki gap, ro'yxat sanamasin.
`;
}

/** Yangi papka: tuzilma va bazadagi eski bilim (jadvallardan bir marta ko'chiriladi; jadvaldagi yozuvlar o'chirilmaydi) */
function create(biz: BusinessRow, dir: string): void {
  // Avval yonida yig'iladi, keyin bitta harakat bilan joyiga qo'yiladi: yarim yo'lda to'xtasa, keyingi safar boshidan boshlanadi
  const root = `${dir}.yangi`, marker = `${dir}.kochirildi`;
  rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  mkdirSync(join(root, ACTIVE), { recursive: true });
  mkdirSync(join(root, WAITING), { recursive: true });
  put(root, 'QOIDALAR.md', RULES);
  // Profildagi manzil va ish vaqti sahifaga hali tushmagan bo'lsa (papka bu sahifadan oldin yaratilib, keyin o'chirilgan) — tushadi
  put(root, ABOUT, about(existsSync(`${dir}.haqida`) ? null : biz));
  // Bazadagi eski bilim faqat bir marta ko'chiriladi: papka keyin o'chirilsa yoki nomi o'zgarsa, eskirgan nusxa qaytib kelmaydi
  const first = !existsSync(marker);
  for (const k of first ? tableKnowledge.list(biz.id) : []) save(root, k);
  const old = first ? tableNotes.list(biz.id) : [];
  if (old.length) put(root, FACTS, `# Faktlar\n\nHar qator — bitta fakt. Cerebro ularni hujjat va javoblarda ishlatadi.\n\n${old.map(n => `- ${n.text.replace(/\s+/g, ' ').trim()} ^${n.id}`).join('\n')}\n`);
  if (first && biz.profile.replyStyle?.trim()) put(root, STYLE, `# Uslub\n\n${biz.profile.replyStyle.trim()}\n`);
  rebuild(biz, root);
  // Windows'da antivirus yoki indekslovchi yangi fayllarni bir zum band qiladi — bir necha marta uriniladi
  for (let attempt = 0; ; attempt++) {
    try { renameSync(root, dir); break; } catch (err) {
      if (attempt >= 5) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150);
    }
  }
  writeFileSync(marker, new Date().toISOString());
}
