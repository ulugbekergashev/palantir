/** Ikkinchi miya — panel yo'llari: ko'rish, savol-javob, tayyor savollarga javob, taklifni tasdiqlash, uslub, namuna, narx ro'yxati */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { MAX_OFFERINGS } from '../../src/lib/prices';
import { knowledgeBlocks, resetConversation } from '../agent';
import { businesses, chatLog, tasks, type BusinessRow } from '../db';
import { addSample, brainView, confirmSuggestion, dropSuggestion, importPrices, knowledgeText, packOf, pricesFromSuggestion, sampleFromSuggestion, saveAnswer } from './index';
import { interviewSkip, interviewStart, interviewStop } from './interview';
import { LIMITS, plain } from './logic';
import { phoneGuide, saveCall, syncTasks } from './mirror';
import { MAX_NOTE, NoteError, noteTree, readNote, writeNote } from './files';
import { obsidianLink } from './obsidian';
import { refresh, style, vault as knowledge, vaultDir } from './vault';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
  fail: (res: Response, e: unknown, code?: number) => unknown;
}

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const QaSchema = z.object({ question: text(3, LIMITS.question).optional(), answer: text(1, LIMITS.answer), packId: z.string().max(40).optional() })
  .refine(v => v.packId || v.question, 'savol kerak');
const EditSchema = z.object({ question: text(3, LIMITS.question).optional(), answer: text(1, LIMITS.sample).optional(), remember: z.literal(true).optional() });
const SampleSchema = z.object({ title: text(2, LIMITS.title), text: text(20, LIMITS.sample) });
const NoteSchema = z.object({ path: z.string().min(4).max(400), content: z.string().max(MAX_NOTE) });
const StyleSchema = z.object({ style: z.string().trim().max(LIMITS.style) });
const PricesSchema = z.object({ items: z.array(z.object({ name: text(2, 80), price: z.number().min(0).max(100_000_000_000) })).min(1).max(MAX_OFFERINGS) });
/** Telefon suhbati (tgvoice/call_live.py): mahalliy vaqt, «Amal» — bajarilgan ish (vazifa qo'shildi va h.k.) */
const CallSchema = z.object({
  startedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/),
  seconds: z.number().min(0).max(86_400),
  withWhom: text(1, 80),
  lines: z.array(z.object({ at: z.string().max(8), who: z.enum(['Siz', 'Cerebro', 'Amal']), text: z.string().max(2000) })).max(600),
});

export function mountBrain(app: Express, { asBiz, bad, fail }: Deps): void {
  // Yordamchi (egasi bilan suhbat) yangi bilimni keyingi gapdan ko'rsin
  const done = (res: Response, biz: BusinessRow, extra: Record<string, unknown> = {}) => {
    resetConversation(biz.id);
    res.json({ ...extra, brain: brainView(businesses.byId(biz.id) ?? biz) });
  };

  app.get('/api/brain', asBiz((_req, res, biz) => res.json({ brain: brainView(biz) })));

  // Telefondagi AI qo'ng'iroq boshida biznesni biladi: kim bilan gaplashadi, Telefon.md dagi ko'rsatma va ovoz,
  // bilim (yordamchi bilan bir xil) va ochiq vazifalar
  // ?for=customer — shahar liniyasiga mijoz qo'ng'iroq qildi: mijozga aytsa bo'ladigan bilim (ovozli agentdagi kabi — filtr
  // ushlaydigan fakt va qatorlarsiz). Egasining ismi, jamoasi, vazifalari va Telefon.md ko'rsatmasi — egasi bilan suhbat uchun, mijozga berilmaydi
  app.get('/api/brain/phone', asBiz((req, res, biz) => {
    const guide = phoneGuide(biz.id, biz.profile.ownerName);
    if (req.query.for === 'customer') {
      res.json({ business: biz.profile.name, owner: '', guide: '', voice: guide.voice, context: knowledgeText(biz) });
      return;
    }
    syncTasks(biz.id);
    const open = tasks.list(biz.id, 'open', 30);
    const list = open.map(t => `- [${t.id}] ${plain(t.title, LIMITS.title)}${t.dueAt ? ` (${t.dueAt.replace('T', ' ')})` : ''}`);
    res.json({
      business: biz.profile.name,
      owner: biz.profile.ownerName,
      guide: guide.text,
      voice: guide.voice,
      context: [...knowledgeBlocks(biz), `<open_tasks>\n${list.length ? list.join('\n') : '(none)'}\n</open_tasks>`].filter(Boolean).join('\n\n'),
    });
  }));

  // «Ikkinchi miya»ni Obsidian'ning o'zida ochish: papka shu kompyuterdagi Obsidian ro'yxatiga qo'shiladi, havolani brauzer ochadi
  // Miya panelda — Obsidian kabi: papkalar daraxti, sahifa (o'qish, saqlash), unga havola qilgan sahifalar. Fayllar Obsidian'dagi bilan bir
  app.get('/api/brain/files', asBiz((_req, res, biz) => { res.json({ tree: noteTree(biz.id) }); }));
  app.get('/api/brain/note', asBiz((req, res, biz) => {
    try {
      res.json({ note: readNote(biz.id, String(req.query.path ?? '')) });
    } catch (e) {
      if (e instanceof NoteError) return res.status(404).json({ error: e.message });
      fail(res, e, 500);
    }
  }));
  app.put('/api/brain/note', asBiz((req, res, biz) => {
    const p = NoteSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try {
      res.json({ note: writeNote(biz.id, p.data.path, p.data.content) });
    } catch (e) {
      if (e instanceof NoteError) return res.status(400).json({ error: e.message });
      fail(res, e, 500);
    }
  }));

  app.get('/api/brain/obsidian', asBiz((_req, res, biz) => {
    res.json({ url: obsidianLink(vaultDir(biz.id)) });
  }));

  // Qo'ng'iroq tugadi — suhbat Obsidian'ga (Qo'ng'iroqlar/)
  app.post('/api/brain/call', asBiz((req, res, biz) => {
    const p = CallSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try {
      res.json({ file: saveCall(biz.id, p.data) });
    } catch (e) {
      fail(res, e, 500);
    }
  }));

  app.post('/api/brain/qa', asBiz((req, res, biz) => {
    const p = QaSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const pack = p.data.packId ? packOf(biz).find(q => q.id === p.data.packId) : null;
    if (p.data.packId && !pack) return res.status(404).json({ error: "Bunday tayyor savol yo'q" });
    try {
      saveAnswer(biz, pack ? pack.question : p.data.question!, p.data.answer, pack ? `pack:${pack.id}` : 'owner');
      done(res, biz);
    } catch (e) { fail(res, e); }
  }));

  app.post('/api/brain/samples', asBiz((req, res, biz) => {
    const p = SampleSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    try { addSample(biz, p.data.title, p.data.text); done(res, biz); } catch (e) { fail(res, e); }
  }));

  app.put('/api/brain/style', asBiz((req, res, biz) => {
    const p = StyleSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    style.set(biz.id, p.data.style);
    done(res, biz);
  }));

  // Narx ro'yxati: brauzerda o'qilgan va egasi ko'rib tasdiqlagan qatorlar. Nomi bir xil xizmatning narxi yangilanadi, qolgani qo'shiladi
  app.post('/api/brain/prices', asBiz((req, res, biz) => {
    const p = PricesSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    done(res, biz, { ...importPrices(biz, p.data.items) });
  }));

  app.delete('/api/brain/prices/:id', asBiz((req, res, biz) => {
    const kept = biz.profile.offerings.filter(o => o.id !== String(req.params.id));
    if (kept.length === biz.profile.offerings.length) return res.status(404).json({ error: 'Topilmadi' });
    businesses.update(biz.id, { profile: { ...biz.profile, offerings: kept } });
    refresh(biz.id);
    done(res, biz);
  }));

  app.patch('/api/brain/:id', asBiz((req, res, biz) => {
    const p = EditSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const id = String(req.params.id);
    const old = knowledge.get(biz.id, id);
    if (!old) return res.status(404).json({ error: 'Topilmadi' });
    if (old.kind !== 'sample' && (p.data.answer?.length ?? 0) > LIMITS.answer) return res.status(400).json({ error: `Javob ${LIMITS.answer} belgidan oshmasin` });
    if (p.data.remember && old.kind === 'sample') return res.status(409).json({ error: "Buni eslab qolib bo'lmaydi" });
    const edited = p.data.question || p.data.answer ? knowledge.update(biz.id, id, { ...(p.data.question ? { question: p.data.question } : {}), ...(p.data.answer ? { answer: p.data.answer } : {}) }) : old;
    if (p.data.remember && !confirmSuggestion(biz, edited!.id)) return res.status(409).json({ error: "Buni eslab qolib bo'lmaydi" });
    done(res, biz);
  }));

  // Birinchi kun suhbati: paneldagi tugma bilan boshlash, o'tkazib yuborish, to'xtatish. Javoblar suhbatning o'zida yoziladi (/api/chat)
  const InterviewSchema = z.object({ action: z.enum(['start', 'skip', 'stop']) });
  app.post('/api/brain/interview', asBiz((req, res, biz) => {
    const p = InterviewSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const turn = p.data.action === 'start' ? interviewStart(biz) : p.data.action === 'skip' ? interviewSkip(biz) : interviewStop(biz);
    if (!turn) return res.status(409).json({ error: 'Savol-javob suhbati ochiq emas' });
    res.json({ entries: [chatLog.add(biz.id, 'web', 'assistant', turn.text)], open: turn.open });
  }));

  // Fayldan kelgan taklif: narxlarini jadvalga olish yoki hujjat namunasi qilish
  app.post('/api/brain/:id/prices', asBiz((req, res, biz) => {
    const r = pricesFromSuggestion(biz, String(req.params.id));
    if (!r) return res.status(404).json({ error: "Taklif topilmadi yoki ichida narx yo'q" });
    done(res, biz, { ...r });
  }));

  app.post('/api/brain/:id/sample', asBiz((req, res, biz) => {
    try {
      if (!sampleFromSuggestion(biz, String(req.params.id))) return res.status(404).json({ error: 'Taklif topilmadi' });
      done(res, biz);
    } catch (e) { fail(res, e, 409); }
  }));

  app.delete('/api/brain/:id', asBiz((req, res, biz) => {
    if (!dropSuggestion(biz, String(req.params.id))) return res.status(404).json({ error: 'Topilmadi' });
    done(res, biz);
  }));
}
