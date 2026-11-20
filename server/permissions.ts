/**
 * Ruxsatlar jadvali (qoidasi — src/lib/permissions.ts): egasi tanlagan darajalar va «So'rasin» tasdiqlari.
 *   gate() — har asbob chaqirilishida (tools.ts runTool): «Hech qachon» — rad; «So'rasin» — asbob BAJARILMAYDI, uning kirishi tasdiq
 *            sifatida saqlanadi va egasiga Telegram'da «✅ Ha / ✖️ Yo'q» boradi (panelda ham ko'rinadi);
 *   decideApproval() — egasi «Ha» bossa, Palantir o'sha asbobni o'sha kirish bilan MODELSIZ bajaradi (deferred.ts dagi kabi): kirish
 *            model ko'rsatmasiga aylanmaydi, egasi aynan nimaga rozi bo'lganini ko'rgan. Chaqiruv paytidagi himoya belgilari
 *            (begona matn o'qilgan, rasm, jadval) saqlanib qaytariladi — tasdiq jadvalning o'zidan boshqa hech qanday himoyani yumshatmaydi.
 */
import type { Express, Request, Response } from 'express';
import type { InlineKeyboardMarkup } from 'telegraf/types';
import { z } from 'zod';
import { businesses, newId, sql, type BusinessRow } from './db';
import { toolKey } from './subscription/deferred';
import type { ToolCtx } from './toolkit';
import type { Artifact } from '../src/types';
import { PERM_ACTIONS, PERM_FIXED, levelFor, permAction, permActionOf, isPermLevel, type PermAction, type PermLevel } from '../src/lib/permissions';
import { TEAM_NAME, crewHas, isCrewMember, type CrewMember } from '../src/lib/crew';

/** Tasdiq shuncha vaqt kutadi — keyin eskiradi (kechagi «qabulga yoz» bugun bajarilib ketmasin) */
export const APPROVAL_TTL_MS = 24 * 3_600_000;
/** Bir biznesda bir vaqtda kutayotgan tasdiqlar chegarasi (model aylanib qolsa, egasini savolga ko'mmasin) */
export const MAX_PENDING = 20;
/** Telegram tugmalari: uy|<id> — ha, un|<id> — yo'q */
export const APPROVE_CODE = 'uy', REJECT_CODE = 'un';

sql.exec(`CREATE TABLE IF NOT EXISTS permission_levels (
  business_id TEXT NOT NULL, action TEXT NOT NULL, level TEXT NOT NULL, PRIMARY KEY (business_id, action)
)`);
sql.exec(`CREATE TABLE IF NOT EXISTS tool_approvals (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, action TEXT NOT NULL, tool TEXT NOT NULL, input TEXT NOT NULL, flags TEXT NOT NULL,
  key TEXT NOT NULL, member TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, decided_at TEXT
)`);
sql.exec('CREATE INDEX IF NOT EXISTS tool_approvals_biz ON tool_approvals (business_id, status, created_at)');

// ─── Darajalar ─────────────────────────────────────────────────────────────────

const chosenOf = (bizId: string): Record<string, string> =>
  Object.fromEntries(sql.many('SELECT action, level FROM permission_levels WHERE business_id = ?', r => [String(r.action), String(r.level)] as const, bizId));

export const levelOf = (bizId: string, action: PermAction): PermLevel => levelFor(action, chosenOf(bizId));

export class PermissionError extends Error {}

/** Egasi darajani o'zgartirdi. «Ruxsat» — standart: yozuv o'chiriladi (keyin standart o'zgarsa, eski tanlov qolib ketmasin) */
export function setLevel(bizId: string, actionId: string, level: PermLevel): void {
  const action = permAction(actionId);
  if (!action) throw new PermissionError("Bunday amal yo'q");
  if (!action.levels.includes(level)) throw new PermissionError(`«${action.title}» uchun bu daraja tanlanmaydi`);
  if (level === 'allow') sql.run('DELETE FROM permission_levels WHERE business_id = ? AND action = ?', bizId, actionId);
  else sql.run('INSERT OR REPLACE INTO permission_levels (business_id, action, level) VALUES (?, ?, ?)', bizId, actionId, level);
}

// ─── Tasdiqlar ─────────────────────────────────────────────────────────────────

/** Chaqiruv paytidagi himoya belgilari: tasdiqdan keyin bajarilganda ham xuddi shunday tekshiriladi */
type Flags = Pick<ToolCtx, 'fromPhoto' | 'unattended' | 'readStrangers' | 'strangerSources' | 'ownerSaid' | 'as'>;
const OWNER_SAID_MAX = 4000;

export interface Approval {
  id: string; action: string; tool: string; member: CrewMember; title: string;
  /** Egasiga ko'rsatiladigan qisqa tafsilot (kirishdan) */
  details: string[]; createdAt: string;
}

interface Row { id: string; businessId: string; action: string; tool: string; input: string; flags: string; member: CrewMember; createdAt: string }
const toRow = (r: Record<string, unknown>): Row => ({
  id: String(r.id), businessId: String(r.business_id), action: String(r.action), tool: String(r.tool), input: String(r.input), flags: String(r.flags),
  member: isCrewMember(r.member) ? r.member : 'yordamchi', createdAt: String(r.created_at),
});

/** Kirish maydonlari egasi tushunadigan nom bilan (qolganlari — o'z nomi bilan) */
const FIELD: Record<string, string> = {
  title: 'Nomi', due_at: 'Vaqti', notes: 'Izoh', name: 'Ism', phone: 'Telefon', text: 'Matn', note: 'Izoh', fact: 'Fakt', kind: 'Turi',
  customer_id: 'Mijoz', patient: 'Bemor', patient_id: 'Bemor', doctor: 'Shifokor', at: 'Vaqti', start: 'Vaqti', amount: "Summa", goal: 'Topshiriq',
  task: 'Topshiriq', message: 'Xabar', topic: 'Mavzu', result: 'Natija', outcome: 'Natija', stage: 'Bosqich', url: 'Manzil', query: "So'rov",
};
const DETAIL_LINES = 6, DETAIL_CHARS = 220;

/** Kirishdan egasiga ko'rsatiladigan qatorlar (sof): bo'sh maydonlar tashlanadi, uzun matn qisqartiriladi */
export function detailsOf(input: unknown): string[] {
  if (!input || typeof input !== 'object') return [];
  const lines: string[] = [];
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (v === null || v === undefined || v === '' || (Array.isArray(v) && !v.length)) continue;
    const text = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v);
    const flat = text.replace(/\s+/g, ' ').trim();
    lines.push(`${FIELD[k] ?? k}: ${flat.length > DETAIL_CHARS ? `${flat.slice(0, DETAIL_CHARS - 1)}…` : flat}`);
    if (lines.length >= DETAIL_LINES) break;
  }
  return lines;
}

const cutoff = (now: number) => new Date(now - APPROVAL_TTL_MS).toISOString();

const view = (r: Row): Approval => {
  const action = permAction(r.action);
  let input: unknown = null;
  try { input = JSON.parse(r.input); } catch { /* buzuq yozuv — tafsilotsiz */ }
  return { id: r.id, action: r.action, tool: r.tool, member: r.member, title: action?.title ?? r.tool, details: detailsOf(input), createdAt: r.createdAt };
};

/** Egasining javobini kutayotgan (eskirmagan) tasdiqlar, yangisi birinchi */
export const pendingApprovals = (bizId: string, now = Date.now()): Approval[] =>
  sql.many("SELECT * FROM tool_approvals WHERE business_id = ? AND status = 'pending' AND created_at >= ? ORDER BY created_at DESC", toRow, bizId, cutoff(now)).map(view);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function approvalHtml(a: Approval): string {
  const body = a.details.length ? `\n<blockquote>${a.details.map(esc).join('\n')}</blockquote>` : '';
  return `🛡 <b>${esc(TEAM_NAME[a.member])} ruxsat so'rayapti</b>\n${esc(a.title)}${body}\n\nRuxsatlar jadvalida bu ish «So'rasin» turibdi. «Ha» bossangiz — Palantir o'zi bajaradi.`;
}

export const approvalKeyboard = (id: string): InlineKeyboardMarkup => ({ inline_keyboard: [[
  { text: '✅ Ha, bajarsin', callback_data: `${APPROVE_CODE}|${id}` },
  { text: "✖️ Yo'q", callback_data: `${REJECT_CODE}|${id}` },
]] });

const ASKED_NOTE = "Egasidan ruxsat so'raldi (Ruxsatlar jadvalida bu ish «So'rasin»): Telegram'da yoki panel → Sozlamalar → Ruxsatlar'da «Ha» bossa, Palantir o'zi bajaradi va natijani egasiga yozadi. Bu asbobni qayta chaqirmang — egasiga shuni qisqa ayting.";

/**
 * «So'rasin»: tasdiq yoziladi va egasiga yuboriladi. Xuddi shu ish (asbob + kirish) allaqachon kutayotgan bo'lsa — qayta so'ralmaydi.
 * Qaytaradi: modelga beriladigan natija
 */
async function ask(name: string, input: unknown, ctx: ToolCtx, action: PermAction, now = Date.now()): Promise<{ content: string; isError: boolean }> {
  const bizId = ctx.biz.id, key = toolKey(name, input);
  const same = sql.one("SELECT id FROM tool_approvals WHERE business_id = ? AND key = ? AND status = 'pending' AND created_at >= ?", r => String(r.id), bizId, key, cutoff(now));
  if (same) return { content: JSON.stringify({ waiting_for_owner: true, note: ASKED_NOTE }), isError: false };
  const waiting = sql.one("SELECT COUNT(*) AS n FROM tool_approvals WHERE business_id = ? AND status = 'pending' AND created_at >= ?", r => Number(r.n), bizId, cutoff(now)) ?? 0;
  if (waiting >= MAX_PENDING) return { content: `Egasining tasdig'ini kutayotgan ishlar juda ko'p (${waiting} ta) — avval ularni egasi hal qilsin. Egasiga shuni ayting.`, isError: true };
  const flags: Flags = {
    fromPhoto: ctx.fromPhoto, unattended: ctx.unattended, readStrangers: ctx.readStrangers, strangerSources: ctx.strangerSources,
    ownerSaid: ctx.ownerSaid?.slice(-OWNER_SAID_MAX), as: ctx.as,
  };
  const row: Row = { id: newId(10), businessId: bizId, action: action.id, tool: name, input: JSON.stringify(input ?? {}), flags: JSON.stringify(flags), member: ctx.as ?? 'yordamchi', createdAt: new Date(now).toISOString() };
  sql.run("INSERT INTO tool_approvals (id, business_id, action, tool, input, flags, key, member, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
    row.id, bizId, row.action, row.tool, row.input, row.flags, key, row.member, row.createdAt);
  // Kechiktirilgan import: inbox/core → agent → tools → permissions aylanasi bo'lmasin
  const { notifyOwner } = await import('./inbox/core');
  const a = view(row);
  const sent = await notifyOwner(ctx.biz, approvalHtml(a), approvalKeyboard(a.id)).catch(e => { console.error('[ruxsat] Telegram:', (e as Error).message); return null; });
  const where = sent ? ASKED_NOTE : `${ASKED_NOTE} (Telegram ulanmagan — faqat panelda.)`;
  return { content: JSON.stringify({ waiting_for_owner: true, note: where }), isError: false };
}

/**
 * Asbob chaqirilishidan oldin (tools.ts runTool). null — bajarilsin; aks holda — modelga shu natija, asbob bajarilmaydi.
 * ctx.approved — egasi shu chaqiruvni allaqachon tasdiqlagan (decideApproval)
 */
export async function gate(name: string, input: unknown, ctx: ToolCtx): Promise<{ content: string; isError: boolean } | null> {
  const action = permActionOf(name);
  if (!action || ctx.approved) return null;
  const level = levelOf(ctx.biz.id, action);
  if (level === 'allow') return null;
  if (level === 'never') {
    return { content: `Egasi Ruxsatlar jadvalida «${action.title}» ishini «Hech qachon» qilib qo'ygan — bajarilmaydi. Egasiga shuni ayting: kerak bo'lsa, Sozlamalar → Ruxsatlar'da o'zi ochadi. Boshqa yo'l bilan aylanib o'tmang.`, isError: true };
  }
  return ask(name, input, ctx, action);
}

/** retry — Claude limiti tufayli bajarilmadi: tasdiq yana kutyapti, egasi keyinroq «Ha»ni qayta bosadi */
export interface Decision { ok: boolean; text: string; artifacts: Artifact[]; retry?: boolean }

/**
 * Egasi javob berdi. Bir marta: tugma ikki marta bosilsa yoki panel va Telegram birga bosilsa — ikkinchisi «eskirgan».
 * «Ha» — asbob o'sha kirish va o'sha himoya belgilari bilan bajariladi
 */
export async function decideApproval(bizId: string, id: string, yes: boolean, now = Date.now()): Promise<Decision> {
  const row = sql.one("SELECT * FROM tool_approvals WHERE id = ? AND business_id = ? AND status = 'pending' AND created_at >= ?", toRow, id, bizId, cutoff(now));
  const taken = row && Number(sql.run("UPDATE tool_approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'", yes ? 'approved' : 'rejected', new Date(now).toISOString(), id).changes) > 0;
  if (!row || !taken) return { ok: false, text: "Bu so'rov eskirgan yoki allaqachon hal qilingan", artifacts: [] };
  const title = permAction(row.action)?.title ?? row.tool;
  if (!yes) return { ok: true, text: `✖️ Bajarilmadi: ${title}`, artifacts: [] };
  const biz = businesses.byId(bizId);
  if (!biz) return { ok: false, text: 'Biznes topilmadi', artifacts: [] };
  let flags: Flags = {}, input: unknown = {};
  try { flags = JSON.parse(row.flags) as Flags; input = JSON.parse(row.input); } catch { return { ok: false, text: "So'rov yozuvi buzilgan — Palantir'ga qayta ayting", artifacts: [] }; }
  const ctx: ToolCtx = { biz, artifacts: [], ...flags, as: isCrewMember(flags.as) ? flags.as : undefined, approved: true };
  const { runTool } = await import('./tools');
  const out = await runTool(row.tool, input, ctx);
  if (out.paused) {
    sql.run("UPDATE tool_approvals SET status = 'pending', decided_at = NULL WHERE id = ?", id);
    return { ok: false, retry: true, text: `⏳ ${title} — hozir bajarib bo'lmadi: ${out.content.slice(0, 300)} So'rov saqlandi: keyinroq «Ha»ni qayta bosing.`, artifacts: [] };
  }
  return out.isError
    ? { ok: false, text: `⚠️ ${title} — bajarilmadi: ${out.content.slice(0, 600)}`, artifacts: ctx.artifacts }
    : { ok: true, text: `✅ Bajarildi: ${title}`, artifacts: ctx.artifacts };
}

// ─── Panel ─────────────────────────────────────────────────────────────────────

/** Jadval qatorlari: faqat jamoadagi xodimlarniki (asosiylari doim). Dasturchi qatori — u yoqilgan serverda */
export function permissionRows(biz: BusinessRow, codeEnabled: boolean) {
  const chosen = chosenOf(biz.id);
  return PERM_ACTIONS.filter(a => crewHas(biz, a.member) && (a.id !== 'code' || codeEnabled)).map(a => ({
    id: a.id, member: a.member, title: a.title, hint: a.hint ?? null, levels: a.levels, level: levelFor(a, chosen),
  }));
}

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asOwner: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
  /** «Ha» bosilganda yaratilgan narsalar (hujjat, vazifa…) Telegram'ga ham — egasi panelda bossa ham natija qo'lida bo'lsin */
  deliver: (biz: BusinessRow, text: string, artifacts: Artifact[]) => Promise<void>;
  codeEnabled: () => boolean;
}

const LevelBody = z.object({ action: z.string().min(1).max(40), level: z.string().refine(isPermLevel, "Daraja: allow, ask yoki never") });
const DecideBody = z.object({ yes: z.boolean() });

export function mountPermissions(app: Express, { asOwner, bad, deliver, codeEnabled }: Deps): void {
  const payload = (biz: BusinessRow) => ({ actions: permissionRows(biz, codeEnabled()), fixed: PERM_FIXED, pending: pendingApprovals(biz.id) });

  app.get('/api/permissions', asOwner((_req, res, biz) => { res.json(payload(biz)); }));

  app.put('/api/permissions', asOwner((req, res, biz) => {
    const p = LevelBody.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try {
      setLevel(biz.id, p.data.action, p.data.level as PermLevel);
    } catch (e) {
      if (e instanceof PermissionError) return res.status(400).json({ error: e.message });
      throw e;
    }
    res.json(payload(biz));
  }));

  app.post('/api/permissions/approvals/:id', asOwner(async (req, res, biz) => {
    const p = DecideBody.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const d = await decideApproval(biz.id, String(req.params.id), p.data.yes);
    if (d.artifacts.length) await deliver(biz, d.text, d.artifacts).catch(e => console.error('[ruxsat] natija Telegram:', (e as Error).message));
    res.json({ ...payload(biz), ok: d.ok, text: d.text });
  }));
}
