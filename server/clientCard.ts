/**
 * Mijoz kartasi — bitta odam haqida hamma narsa: qaysi kanallarda yozishadi, nechta xabar va qo'ng'iroq, so'rovlari,
 * qo'ng'iroqlari (yozuv va tahlil bilan) va DentaCRM'dagi bemor: oxirgi tashrif, balans, yaqin qabullari.
 * CRM javob bermasa — karta baribir chiqadi, bemor qismida sababi bilan.
 */
import type { ClientCardView } from '../src/types';
import { calls, inbox, leads, publicLead, sql, type BusinessRow } from './db';
import { crmConnected, withCrm } from './crm/index';
import { patientName } from './crm/logic';
import { upcomingVisits } from './crm/reception';
import { requests } from './requests/store';
// Qo'ng'iroqlar jadvalining lead_id ustuni shu yerda tayyor bo'lsin
import './phone/store';

const CRM_WAIT_MS = 6_000;

export async function clientCard(biz: BusinessRow, leadId: string): Promise<ClientCardView | null> {
  const lead = leads.get(biz.id, leadId);
  if (!lead) return null;
  const counts = Object.fromEntries(sql.many('SELECT channel, COUNT(*) n FROM inbox WHERE business_id = ? AND lead_id = ? GROUP BY channel', r => [String(r.channel), Number(r.n)] as const, biz.id, lead.id)) as Record<string, number>;
  const first = sql.one('SELECT MIN(created_at) AS at FROM inbox WHERE business_id = ? AND lead_id = ?', r => sql.str(r.at), biz.id, lead.id) ?? null;
  const view: ClientCardView = {
    lead: publicLead(lead),
    // Kanal: akkaunt id'si bo'lsa yoki shu kanalda yozishma bo'lsa (qo'lda qo'shilgan, eski yozuvlar)
    channels: {
      instagram: lead.igUserId || counts.instagram ? (lead.username && lead.channel === 'instagram' ? `@${lead.username}` : 'Direct') : null,
      telegram: lead.tgUserId || counts.bot || counts.telegram ? (lead.botStarted || counts.bot ? 'bot' : 'shaxsiy Telegram') : null,
      phone: lead.phone,
    },
    messages: { instagram: counts.instagram ?? 0, telegram: (counts.telegram ?? 0) + (counts.bot ?? 0), total: Object.values(counts).reduce((a, b) => a + b, 0) },
    lastMessageAt: inbox.last(biz.id, lead.id)?.createdAt ?? null,
    firstMessageAt: first,
    requests: requests.forLead(biz.id, lead.id, 30),
    calls: calls.forLead(biz.id, lead.id, 30),
    patient: null,
  };
  if (!lead.patientId || !crmConnected(biz.id)) return view;
  try {
    const timeout = new Promise<never>((_, reject) => { setTimeout(() => reject(new Error('DentaCRM javob bermadi')), CRM_WAIT_MS).unref(); });
    const [list, upcoming] = await Promise.race([timeout, Promise.all([withCrm(biz.id, crm => crm.patients()), upcomingVisits(biz.id, lead.patientId)])]);
    const p = list.find(x => x.id === lead.patientId);
    view.patient = p ? { id: p.id, name: patientName(p), phone: p.phone, lastVisit: p.lastVisit, balance: p.balance, upcoming, problem: null }
      : { id: lead.patientId, name: '', phone: null, lastVisit: null, balance: 0, upcoming: [], problem: "Bemor DentaCRM'da topilmadi (o'chirilgan bo'lishi mumkin)" };
  } catch (e) {
    view.patient = { id: lead.patientId, name: '', phone: null, lastVisit: null, balance: 0, upcoming: [], problem: (e as Error).message };
  }
  return view;
}
