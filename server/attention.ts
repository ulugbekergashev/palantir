/**
 * «Sizni kutyapti» — hamma AI xodimdan egasining qarorini kutayotgan narsalar bitta ro'yxatda (bosh ekran):
 *   Qabulxona — tasdiq kutayotgan AI javoblari va ochiq so'rovlar (qayta qo'ng'iroq, yozilish, shikoyat);
 *   Kuzatuvchi — egasi hali ko'rmagan kamera hodisalari (oxirgi sutka);
 *   Yordamchi — muddati o'tgan ishlar; har xodim — bajarilmay qolgan topshiriqlar.
 * Har biri o'z joyidagi tugma bilan hal qilinadi (javob yuborish, so'rovni yopish, «ko'rdim», ishni surish).
 */
import type { Express, Request, Response } from 'express';
import type { OrderMember } from '../src/types';
import { dueLabel, stamp } from '../src/lib/week';
import { leads, replies, tasks, type BusinessRow } from './db';
import { requests } from './requests/store';
import { events, orders } from './orders/store';
import { requestKind } from '../src/lib/requests';

type Handler = (req: Request, res: Response) => unknown;
interface Deps { asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler }

export type AttentionKind = 'camera' | 'request' | 'reply' | 'task' | 'order';
export interface AttentionItem {
  /** Ro'yxat kaliti: tur va manba id */
  key: string; kind: AttentionKind; member: OrderMember;
  /** Manbaning o'z id'si (javob, so'rov, hodisa, vazifa, topshiriq) — tugmalar shu bilan ishlaydi */
  refId: string; title: string; body: string; at: string; phone: string | null;
  /** Hodisa darajasi (kamera) yoki kechikkan — tepaga */
  urgent: boolean;
}

const DAY_MS = 86_400_000;
const LIMIT = 30;
const ORDER: AttentionKind[] = ['camera', 'request', 'reply', 'task', 'order'];
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function attention(biz: BusinessRow, now = new Date()): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const e of events.unseen(biz.id, new Date(now.getTime() - DAY_MS).toISOString())) {
    items.push({ key: `camera:${e.id}`, kind: 'camera', member: e.member, refId: e.id, title: e.title, body: e.body, at: e.at, phone: null, urgent: e.level === 'crit' });
  }
  for (const r of requests.list(biz.id, 'open', LIMIT)) {
    const lead = r.leadId ? leads.get(biz.id, r.leadId) : null;
    const who = r.name ?? lead?.name ?? lead?.username ?? 'Mijoz';
    items.push({ key: `request:${r.id}`, kind: 'request', member: 'qabulxona', refId: r.id, title: `${requestKind(r.kind)} · ${who}`, body: cut(r.summary + (r.whenText ? ` · ${r.whenText}` : ''), 240), at: r.createdAt, phone: r.phone ?? lead?.phone ?? null, urgent: r.kind === 'complaint' });
  }
  for (const r of replies.pendingList(biz.id, LIMIT)) {
    const lead = leads.get(biz.id, r.leadId);
    const who = lead?.name ?? (lead?.username ? `@${lead.username}` : null) ?? lead?.phone ?? 'Mijoz';
    items.push({ key: `reply:${r.id}`, kind: 'reply', member: 'qabulxona', refId: r.id, title: `${who}ga javob tayyor`, body: cut(r.text, 280), at: r.createdAt, phone: null, urgent: false });
  }
  const nowStamp = stamp(now);
  for (const t of tasks.list(biz.id, 'open', 200).filter(t => t.dueAt && t.dueAt < nowStamp).slice(0, LIMIT)) {
    items.push({ key: `task:${t.id}`, kind: 'task', member: 'yordamchi', refId: t.id, title: t.title, body: `Muddati: ${dueLabel(biz.profile.contentLang ?? 'uz', t.dueAt!, now)}`, at: t.dueAt!, phone: null, urgent: false });
  }
  for (const o of orders.list(biz.id).filter(o => o.active && o.lastResult?.startsWith('Bajarilmadi'))) {
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
}
