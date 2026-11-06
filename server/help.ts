/**
 * «Yordam so'rash» — klinika tomoni (hub tomoni — hub/help.ts). Egasi yoki boshqaruvchi muammoni o'z so'zi bilan yozadi: panelda
 * Sozlamalar → Yordam, yoki egasi botda /yordam. So'rov Palantir Hub'ga ketadi, xohlasa diagnostika bilan (server/diagnostics.ts:
 * holat va jurnallar, parol va kalitlarsiz). Jamoa /admin da javob yozadi. Javob navbat orqali keladi (help_answer,
 * inbox/instagramApi.ts) — shu yerda yoziladi, egasining Telegramiga boradi va panelda ko'rinadi.
 * Hub ulanmagan bo'lsa so'rov yuborilmaydi: panel buni aytadi, egasi sotuvchiga o'zi yozadi.
 * Palantir jamoasining o'zi (jamoa kirishi bilan) so'rov yubora olmaydi — so'rov egasining nomidan ketadi.
 */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { cut, esc } from './botKit';
import { businesses, sql, type BusinessRow } from './db';
import { diagnostics } from './diagnostics';
import { env } from './env';
import { fitBytes } from './fitBytes';
import { notifyOwner } from './inbox/core';

const { one, many, run, nowIso, str } = sql;

export const HELP_TEXT_MIN = 5;
export const HELP_TEXT_MAX = 2000;
/** Panelda ko'rinadigan oxirgi so'rovlar */
const HELP_SHOWN = 10;
/** Egasiga javob bilan birga eslatiladigan so'rov matni */
const ASKED_QUOTE = 300;
const HUB_TIMEOUT_MS = 30_000;
/**
 * Hub so'rov tanasini 1 MB gacha qabul qiladi (hub/server.ts MAX_BODY); JSON'da qator tashlash va qo'shtirnoq ikki belgi bo'ladi.
 * Jurnal qatorlari uzun bo'lsa (xato izi) diagnostika shundan oshadi — aynan muammo paytida so'rov yiqilmasin
 */
const DIAG_MAX_BYTES = 600_000;

// id — hub bergan (12 ta hex): javob shu bo'yicha topiladi
sql.exec(`CREATE TABLE IF NOT EXISTS help_requests (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, by_name TEXT, text TEXT NOT NULL, with_diag INTEGER NOT NULL,
  created_at TEXT NOT NULL, answer TEXT, answered_at TEXT, answered_by TEXT)`);

export class HelpError extends Error {}

export interface HelpRequest {
  id: string; text: string; by: string | null; withDiag: boolean; createdAt: string;
  answer: string | null; answeredAt: string | null; answeredBy: string | null;
}
const toRequest = (r: Record<string, unknown>): HelpRequest => ({
  id: String(r.id), text: String(r.text), by: str(r.by_name), withDiag: Number(r.with_diag) === 1, createdAt: String(r.created_at),
  answer: str(r.answer), answeredAt: str(r.answered_at), answeredBy: str(r.answered_by),
});

export const helpRequests = {
  list: (bizId: string): HelpRequest[] => many('SELECT * FROM help_requests WHERE business_id = ? ORDER BY created_at DESC LIMIT ?', toRequest, bizId, HELP_SHOWN),
  get: (id: string) => one('SELECT * FROM help_requests WHERE id = ?', r => ({ ...toRequest(r), businessId: String(r.business_id) }), id),
};

/** Hub'ga yuboradi va shu yerda yozib qo'yadi. Hub yo'q, aloqa yo'q yoki rad etsa — HelpError (egasiga ko'rsatiladigan matn bilan) */
export async function askHelp(biz: BusinessRow, by: string | null, text: string, withDiag: boolean): Promise<HelpRequest> {
  const hub = env.hub;
  if (!hub) throw new HelpError("Palantir Hub ulanmagan — so'rovni yuborib bo'lmaydi. Sotuvchiga Telegram'da yozing");
  const body = { business: biz.id, businessName: biz.profile.name, by, text, ...(withDiag ? { diag: fitBytes(diagnostics().text, DIAG_MAX_BYTES) } : {}) };
  let r: globalThis.Response;
  try {
    r = await fetch(`${hub.url}/api/help`, {
      method: 'POST', headers: { authorization: `Bearer ${hub.key}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(HUB_TIMEOUT_MS),
    });
  } catch (e) {
    console.warn("[yordam] hubga yetmadi:", (e as Error).message);
    throw new HelpError("Palantir Hub bilan aloqa yo'q — internetni tekshirib, qayta urining");
  }
  const j = await r.json().catch(() => ({})) as { id?: unknown; error?: unknown };
  const id = typeof j.id === 'string' && /^[0-9a-f]{12}$/.test(j.id) ? j.id : null;
  if (!r.ok || !id) throw new HelpError(typeof j.error === 'string' ? j.error : `Hub so'rovni qabul qilmadi (${r.status})`);
  run('INSERT INTO help_requests (id, business_id, by_name, text, with_diag, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, biz.id, by, text, withDiag ? 1 : 0, nowIso());
  return helpRequests.get(id)!;
}

/**
 * Hub navbatidan: jamoa javob berdi. So'rov shu yerda yozilmagan bo'lishi mumkin (hub qabul qilib, javobi klinikaga yetmagan — egasi
 * «aloqa yo'q» ko'rgan) — unda hub aytgan biznes va so'rov matni bilan yoziladi. Javob qayta kelsa (jamoa «Qayta yuborish»ni bosgan,
 * navbat takrorlangan) — egasiga ikkinchi marta yozilmaydi.
 */
export async function onHelpAnswer(payload: unknown): Promise<void> {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const id = String(p.id ?? '');
  const answer = typeof p.text === 'string' ? p.text.trim().slice(0, HELP_TEXT_MAX) : '';
  const known = helpRequests.get(id);
  const biz = businesses.byId(known?.businessId ?? String(p.business ?? ''));
  if (!/^[0-9a-f]{12}$/.test(id) || !answer || !biz) return void console.warn(`[yordam] javob keldi, lekin so'rov yoki biznes topilmadi: ${id}`);
  if (known?.answer) return;
  const who = typeof p.who === 'string' ? p.who.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 60) || null : null;
  const asked = known?.text ?? (typeof p.asked === 'string' && p.asked.trim() ? p.asked.trim().slice(0, HELP_TEXT_MAX) : "(so'rov matni yetib kelmadi)");
  if (known) run('UPDATE help_requests SET answer = ?, answered_at = ?, answered_by = ? WHERE id = ?', answer, nowIso(), who, id);
  else {
    run('INSERT INTO help_requests (id, business_id, by_name, text, with_diag, created_at, answer, answered_at, answered_by) VALUES (?, ?, NULL, ?, 0, ?, ?, ?, ?)',
      id, biz.id, asked, nowIso(), answer, nowIso(), who);
  }
  await notifyOwner(biz, `💬 <b>${who ? `Palantir jamoasidan ${esc(who)}` : 'Palantir jamoasi'} javob berdi</b>\nSo'rovingiz: «${esc(cut(asked, ASKED_QUOTE))}»\n\n${esc(answer)}`).catch(() => null);
}

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
  fail: (res: Response, e: unknown, code?: number) => unknown;
  /** Kim yozyapti: Palantir jamoasi (jamoa kirishi) yoki klinika xodimi (boshqaruvchi) — ismi; egasi — null */
  asker: (req: Request) => { support: boolean; staffName: string | null };
}

const AskSchema = z.object({ text: z.string().trim().min(HELP_TEXT_MIN).max(HELP_TEXT_MAX), diag: z.boolean().default(true) });

export function mountHelp(app: Express, { asBiz, bad, fail, asker }: Deps): void {
  // support — hozirgi kirish Palantir jamoasiniki: u so'rov yubormaydi (panel formani ko'rsatmaydi)
  app.get('/api/help', asBiz((req, res, biz) => {
    res.json({ hub: !!env.hub, support: asker(req).support, requests: helpRequests.list(biz.id) });
  }));
  app.post('/api/help', asBiz(async (req, res, biz) => {
    const who = asker(req);
    if (who.support) return res.status(403).json({ error: "Palantir jamoasi so'rovni o'ziga yubormaydi — bu egasining tugmasi" });
    const p = AskSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try {
      res.json({ request: await askHelp(biz, who.staffName ?? (biz.profile.ownerName || null), p.data.text, p.data.diag) });
    } catch (e) {
      if (e instanceof HelpError) return fail(res, e);
      throw e;
    }
  }));
}
