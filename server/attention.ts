/**
 * «Sizni kutyapti» — hamma AI xodimdan egasining qarorini kutayotgan narsalar bitta ro'yxatda (bosh ekran):
 *   Qabulxona — javob kutayotgan bemorlar (AI javob bermay egasiga uzatgan), tasdiq kutayotgan AI javoblari, ochiq so'rovlar
 *               va mijozlarga xabar qoralamalari;
 *   Kuzatuvchi — egasi hali ko'rmagan kamera hodisalari (oxirgi sutka);
 *   Yordamchi — muddati o'tgan ishlar; har xodim (jamoada bo'lsa) — bajarilmay qolgan topshiriqlar.
 *   Kontent-meyker — tasdiq kutayotgan postlar; Targetolog — tasdiq kutayotgan reklama rejalari.
 *   Direktor — tasdiq kutayotgan takliflar.
 * Har biri o'z joyidagi tugma bilan hal qilinadi (javob yuborish, so'rovni yopish, «ko'rdim», ishni surish).
 */
import type { Express, Request, Response } from 'express';
import type { EventMember } from '../src/types';
import { dueLabel, stamp } from '../src/lib/week';
import { crewHas } from '../src/lib/crew';
import { inbox, leads, outbound, replies, tasks, type BusinessRow } from './db';
import { contentStore } from './content/store';
import { posts } from './marketing/posts';
import { adsStore } from './ads/store';
import { waiting } from './serviceStore';
import { awaitingReply } from './inbox/hold';
import { requests } from './requests/store';
import { events, orders } from './orders/store';
import { requestKind } from '../src/lib/requests';
import { directorMoves } from './director/store';
import { MEMBER_NAME } from './director/logic';

type Handler = (req: Request, res: Response) => unknown;
interface Deps { asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler }

export type AttentionKind = 'message' | 'director' | 'camera' | 'request' | 'reply' | 'outbound' | 'task' | 'content' | 'ads' | 'order';
export interface AttentionItem {
  /** Ro'yxat kaliti: tur va manba id */
  key: string; kind: AttentionKind; member: EventMember | 'direktor';
  /** Manbaning o'z id'si (javob, so'rov, hodisa, vazifa, topshiriq) — tugmalar shu bilan ishlaydi */
  refId: string; title: string; body: string; at: string; phone: string | null;
  /** Hodisa darajasi (kamera) yoki kechikkan — tepaga */
  urgent: boolean;
  /** Xabar qoralamasi: Palantir o'zi yubora oladimi */
  canSend?: boolean;
  /** So'rov qatorida shu bemorga javob taklifi (B8: bitta voqea — bitta qator; alohida «javob tayyor» qatori bo'lmaydi) */
  reply?: { id: string; text: string };
}

const DAY_MS = 86_400_000;
const LIMIT = 30;
/** Ochiq so'rovlar shundan o'qiladi (eng yangi LIMIT tasi ko'rsatiladi) */
const OPEN_SCAN = 500;
const ORDER: AttentionKind[] = ['message', 'director', 'camera', 'request', 'reply', 'outbound', 'task', 'content', 'ads', 'order'];
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function attention(biz: BusinessRow, now = new Date()): AttentionItem[] {
  const items: AttentionItem[] = [];
  // Direktor takliflari: «Topshirish» — xodimga topshiriq va Xotira'ga qaror (director/index.ts)
  for (const m of directorMoves.waiting(biz.id)) {
    items.push({ key: `director:${m.id}`, kind: 'director', member: 'direktor', refId: m.id, title: `Direktor: ${m.member === 'egasi' ? 'sizga' : `${MEMBER_NAME[m.member]}ga`} taklif`, body: cut(`${m.task}${m.why ? ` — ${m.why}` : ''}`, 280), at: m.createdAt, phone: null, urgent: false });
  }
  for (const e of events.unseen(biz.id, new Date(now.getTime() - DAY_MS).toISOString())) {
    items.push({ key: `camera:${e.id}`, kind: 'camera', member: e.member, refId: e.id, title: e.title, body: e.body, at: e.at, phone: null, urgent: e.level === 'crit' });
  }
  // Eng yangilari: ochiq so'rov ko'p bo'lsa (eskilari yopilmay qolgan), yangisi ro'yxatdan chiqib ketmasin (G1)
  const open = requests.list(biz.id, 'open', OPEN_SCAN).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, LIMIT);
  const pendingReplies = replies.pendingList(biz.id, LIMIT);
  /** So'rov qatoriga qo'shilgan javob takliflari — pastda alohida qator bo'lmaydi */
  const joined = new Set<string>();
  for (const r of open) {
    const lead = r.leadId ? leads.get(biz.id, r.leadId) : null;
    const who = r.name ?? lead?.name ?? lead?.username ?? 'Mijoz';
    // Shikoyat — alohida (Telegram'da ham faqat egasiga, javob bilan birlashmaydi)
    const reply = r.kind !== 'complaint' && lead ? pendingReplies.find(p => p.leadId === lead.id && !joined.has(p.id)) : undefined;
    if (reply) joined.add(reply.id);
    items.push({ key: `request:${r.id}`, kind: 'request', member: 'qabulxona', refId: r.id, title: `${requestKind(r.kind)} · ${who}`, body: cut(r.summary + (r.whenText ? ` · ${r.whenText}` : ''), 240), at: r.createdAt, phone: r.phone ?? lead?.phone ?? null, urgent: r.kind === 'complaint', ...(reply ? { reply: { id: reply.id, text: cut(reply.text, 280) } } : {}) });
  }
  // Bemor javob kutyapti: AI javob bermay egasiga uzatgan suhbatlar (inbox/core.ts: forward) — Telegram ulanmagan bo'lsa ham shu yerda
  const requested = new Set(open.map(r => r.leadId).filter(Boolean));
  for (const w of waiting.list(biz.id, LIMIT)) {
    const lead = leads.get(biz.id, w.leadId);
    // Javob yozildi (egasi, xodim yoki Palantir; avtomatik «yetkazildi» — javob emas) yoki karta o'chirildi — kutish tugadi
    const last = lead ? awaitingReply(inbox.thread(biz.id, lead.id, 30)) : null;
    if (!lead || !last) { waiting.remove(biz.id, w.leadId); continue; }
    // Javob taklifi yoki ochiq so'rov bor — bemor o'sha qatorda turibdi (ikki marta ko'rsatilmaydi)
    if (replies.countPending(biz.id, lead.id) || requested.has(lead.id)) continue;
    const who = lead.name ?? (lead.username ? `@${lead.username}` : null) ?? lead.phone ?? 'Mijoz';
    items.push({ key: `message:${lead.id}`, kind: 'message', member: 'qabulxona', refId: lead.id, title: `${who} javob kutyapti`, body: cut(`«${last.text}»${w.note ? ` — ${w.note}` : ''}`, 280), at: w.since, phone: lead.phone, urgent: false });
  }
  for (const r of pendingReplies.filter(p => !joined.has(p.id))) {
    const lead = leads.get(biz.id, r.leadId);
    const who = lead?.name ?? (lead?.username ? `@${lead.username}` : null) ?? lead?.phone ?? 'Mijoz';
    items.push({ key: `reply:${r.id}`, kind: 'reply', member: 'qabulxona', refId: r.id, title: `${who}ga javob tayyor`, body: cut(r.text, 280), at: r.createdAt, phone: null, urgent: false });
  }
  const nowStamp = stamp(now);
  for (const t of tasks.list(biz.id, 'open', 200).filter(t => t.dueAt && t.dueAt < nowStamp).slice(0, LIMIT)) {
    items.push({ key: `task:${t.id}`, kind: 'task', member: 'yordamchi', refId: t.id, title: t.title, body: `Muddati: ${dueLabel(biz.profile.contentLang ?? 'uz', t.dueAt!, now)}`, at: t.dueAt!, phone: null, urgent: false });
  }
  // Mijozlarga xabar qoralamalari (Qabulxona: unutilgan mijozlarga qayta yozish) — egasi yuboradi yoki bekor qiladi (G8)
  for (const o of outbound.list(biz.id, LIMIT).filter(o => o.status === 'draft')) {
    // canSend: Palantir yoza oladigan mijoz bor (bot, Telegram, Instagram) — qolganlariga egasi o'zi qo'ng'iroq qiladi yoki yozadi
    items.push({ key: `outbound:${o.id}`, kind: 'outbound', member: 'qabulxona', refId: o.id, title: `${o.leadIds.length} ta mijozga xabar tayyor${!o.reachable ? " — o'zingiz yozasiz yoki qo'ng'iroq qilasiz" : o.reachable < o.leadIds.length ? ` (Palantir ${o.reachable} tasiga yoza oladi)` : ''}`, body: cut(o.text, 280), at: o.createdAt, phone: null, urgent: false, canSend: o.reachable > 0 });
  }
  // Kontent-meyker: tasdiq kutayotgan postlar (Telegram kanal va Instagram) — bitta band, son bilan
  if (crewHas(biz, 'kontent')) {
    const drafts = contentStore.drafts(biz.id).filter(d => d.status === 'draft' || d.status === 'failed');
    const ig = posts.list(biz.id).filter(p => p.status === 'draft' || p.status === 'failed' || p.status === 'unknown');
    const newest = [...drafts.map(d => ({ text: d.text, at: d.createdAt })), ...ig.map(p => ({ text: p.caption, at: p.createdAt }))].sort((a, b) => (a.at < b.at ? 1 : -1))[0];
    if (newest) items.push({ key: 'content:posts', kind: 'content', member: 'kontent', refId: 'posts', title: `${drafts.length + ig.length} ta post tasdiq kutyapti`, body: cut(newest.text, 200), at: newest.at, phone: null, urgent: false });
  }
  // Targetolog: tasdiq kutayotgan reklama rejalari
  if (crewHas(biz, 'target')) {
    for (const c of adsStore.campaigns(biz.id).filter(c => c.status === 'proposed')) {
      items.push({ key: `ads:${c.id}`, kind: 'ads', member: 'target', refId: c.id, title: 'Reklama rejasi tasdiq kutyapti', body: cut(c.task, 240), at: c.createdAt, phone: null, urgent: false });
    }
  }
  // Jamoadan chiqarilgan xodimning bajarilmagan topshirig'i ro'yxatda abadiy turmasin (G8)
  for (const o of orders.list(biz.id).filter(o => o.active && o.lastResult?.startsWith('Bajarilmadi') && crewHas(biz, o.member))) {
    items.push({ key: `order:${o.id}`, kind: 'order', member: o.member, refId: o.id, title: `Topshiriq bajarilmadi: ${cut(o.text, 80)}`, body: cut(o.lastResult ?? '', 200), at: o.lastRunAt ?? o.createdAt, phone: null, urgent: false });
  }
  // Shoshilinchi tepada, keyin tur bo'yicha, har tur ichida — yangisi oldin
  return items.sort((a, b) => Number(b.urgent) - Number(a.urgent) || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind) || (a.at < b.at ? 1 : -1));
}

export function mountAttention(app: Express, { asBiz }: Deps): void {
  app.get('/api/attention', asBiz((_req, res, biz) => { res.json({ items: attention(biz) }); }));
  app.post('/api/agents/events/:id/seen', asBiz((req, res, biz) => {
    if (!events.see(biz.id, String(req.params.id))) return res.status(404).json({ error: 'Topilmadi' });
    res.json({ ok: true });
  }));
  // «Javob kerak emas»: bemorga boshqa joyda (telefonda, ilovada) javob berilgan yoki javob shart emas
  app.post('/api/attention/waiting/:leadId/dismiss', asBiz((req, res, biz) => {
    waiting.remove(biz.id, String(req.params.leadId));
    res.json({ ok: true });
  }));
}
