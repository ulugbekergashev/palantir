/**
 * Bitta odam — bitta mijoz kartasi. Odam Instagram'da yozib raqam qoldirsa, keyin botga yozsa yoki qo'ng'iroq qilsa,
 * telefon raqami (oxirgi 9 raqam) uni bitta kartaga yig'adi: yozishmalar, takliflar, vazifalar, so'rovlar va qo'ng'iroqlar birga.
 * Qachon bir odam deb hisoblanishi — personRules.ts.
 *
 * DentaCRM ulangan klinikada mijoz kartasi bemorga bog'lanadi: telefoni va to'liq ismi mos (yoki to'liq ism yo'q va bu telefonda
 * bitta bemor) bo'lsa.
 */
import { leads, sql, type BusinessRow, type LeadRow } from './db';
import { crmConnected, withCrm } from './crm/index';
import type { Patient } from './crm/logic';
import { fullerName, namesFit, patientFor, samePerson } from './personRules';
// Kartalar qo'shilganda so'rovlar va qo'ng'iroqlar ham ko'chadi — ularning jadvali shu yerda tayyor bo'lsin
import './requests/store';

const STAGE_RANK = { new: 0, contacted: 1, lost: 2, won: 3 } as const;
/** So'rov kartasi bemor ma'lumoti bilan chiqsin deb CRM shuncha kutiladi (javob bermasa — kartasiz emas, bemor qatorisiz) */
const LINK_WAIT_MS = 3_000;

/**
 * drop kartasini keep'ga qo'shadi va o'chiradi. keep — hozir ishlanayotgan karta (chaqiruvchidagi id eskirmasin):
 * bo'sh maydonlari drop'dagidan to'ldiriladi, yaratilgan payti — eng eskisi, bosqichi — ilgarirog'i
 */
function absorb(bizId: string, keep: LeadRow, drop: LeadRow): void {
  const stage = STAGE_RANK[drop.stage] > STAGE_RANK[keep.stage] ? drop.stage : keep.stage;
  const note = keep.note && drop.note && keep.note !== drop.note ? `${keep.note} · ${drop.note}`.slice(0, 500) : keep.note ?? drop.note;
  const [nextStep, nextAt] = keep.nextAt ? [keep.nextStep, keep.nextAt] : [drop.nextStep, drop.nextAt];
  const latest = (a: string | null, b: string | null) => (!a ? b : !b ? a : a > b ? a : b);
  sql.tx(() => {
    sql.run(`UPDATE leads SET name = ?, username = COALESCE(username, ?), tg_user_id = COALESCE(tg_user_id, ?), tg_access_hash = COALESCE(tg_access_hash, ?),
      ig_user_id = COALESCE(ig_user_id, ?), ig_thread = COALESCE(ig_thread, ?), bot_started = MAX(bot_started, ?), patient_id = COALESCE(patient_id, ?),
      source = COALESCE(source, ?), post_id = COALESCE(post_id, ?), stage = ?, note = ?, next_step = ?, next_at = ?, last_inbound_at = ?,
      created_at = MIN(created_at, ?), updated_at = ? WHERE business_id = ? AND id = ?`,
      fullerName(keep.name, drop.name), drop.username, drop.tgUserId, drop.tgAccessHash, drop.igUserId, drop.igThread, drop.botStarted ? 1 : 0, drop.patientId ?? null,
      drop.source, drop.postId, stage, note, nextStep, nextAt, latest(keep.lastInboundAt, drop.lastInboundAt),
      drop.createdAt, sql.nowIso(), bizId, keep.id);
    for (const table of ['inbox', 'replies', 'tasks', 'requests', 'calls']) {
      sql.run(`UPDATE ${table} SET lead_id = ? WHERE business_id = ? AND lead_id = ?`, keep.id, bizId, drop.id);
    }
    sql.run('UPDATE relays SET lead_id = ? WHERE lead_id = ?', keep.id, drop.id);
    // Tayyorlangan ommaviy xabarlardagi ro'yxat: id'lar tasodifiy 10 belgi — qo'shtirnoq bilan almashtirish xavfsiz
    sql.run(`UPDATE outbound SET lead_ids = REPLACE(lead_ids, ?, ?) WHERE business_id = ? AND status = 'draft'`, `"${drop.id}"`, `"${keep.id}"`, bizId);
    sql.run('DELETE FROM leads WHERE business_id = ? AND id = ?', bizId, drop.id);
  });
}

/** Shu telefonli boshqa kartalardan bir odamnikini shu kartaga yig'adi. Qaytadi: yangilangan karta va qo'shilganlar soni */
export function mergeByPhone(bizId: string, leadId: string): { lead: LeadRow | undefined; merged: number } {
  let lead = leads.get(bizId, leadId);
  if (!lead?.phone) return { lead, merged: 0 };
  let merged = 0;
  for (const other of leads.byPhone(bizId, lead.phone)) {
    if (other.id === lead.id || !samePerson(lead, other)) continue;
    absorb(bizId, lead, other);
    merged++;
    lead = leads.get(bizId, leadId)!;
  }
  return { lead, merged };
}

/** Kartani DentaCRM bemoriga bog'laydi (CRM ulangan va bog'lanmagan bo'lsa). CRM javob bermasa — jim: keyingi safar yana uriniladi */
export async function linkPatient(biz: BusinessRow, leadId: string): Promise<string | null> {
  const lead = leads.get(biz.id, leadId);
  if (!lead?.phone || lead.patientId || !crmConnected(biz.id)) return lead?.patientId ?? null;
  let list: Patient[];
  try { list = await withCrm(biz.id, crm => crm.patients()); } catch { return null; }
  const p = patientFor(list, lead.name, lead.phone);
  if (!p) return null;
  leads.setPatient(biz.id, lead.id, p.id);
  const full = `${p.firstName} ${p.lastName}`.trim();
  // Bemor kartasidagi ism — haqiqiy ism (Telegram'dagi laqabdan to'liqrog'i)
  if (full && fullerName(lead.name, full) === full) leads.update(biz.id, lead.id, { name: full });
  return p.id;
}

/**
 * Kartaga telefon yozildi (mijoz o'zi aytdi, kontakt yubordi, egasi kiritdi, qo'ng'iroq qildi): bir odamning boshqa kartalari
 * shu kartaga yig'iladi, keyin fonda DentaCRM bemori qidiriladi. Qaytadi — yangilangan karta
 */
export function phoneChanged(biz: BusinessRow, leadId: string): LeadRow | undefined {
  const { lead } = mergeByPhone(biz.id, leadId);
  if (lead && !lead.patientId && crmConnected(biz.id)) void linkPatient(biz, lead.id).catch(e => console.error('[mijoz] bemor qidirilmadi:', (e as Error).message));
  return lead;
}

/** phoneChanged, lekin bemor qidiruvi qisqa kutiladi: xodimga ketadigan kartada «DentaCRM bemori» ko'rinsin */
export async function settlePerson(biz: BusinessRow, leadId: string): Promise<LeadRow | undefined> {
  const { lead } = mergeByPhone(biz.id, leadId);
  if (lead && !lead.patientId && crmConnected(biz.id)) {
    const link = linkPatient(biz, lead.id).catch(e => { console.error('[mijoz] bemor qidirilmadi:', (e as Error).message); return null; });
    await Promise.race([link, new Promise(r => setTimeout(r, LINK_WAIT_MS).unref())]);
  }
  return lead ? leads.get(biz.id, lead.id) : undefined;
}

/** Telefon bo'yicha karta: bir odamniki bo'lsa — o'sha (eng eskisi), bo'lmasa — yangisi ochiladi */
export function leadForPhone(biz: BusinessRow, phone: string, v: { name: string | null; source: string; note?: string | null }): LeadRow {
  const same = leads.byPhone(biz.id, phone).filter(l => namesFit(l.name, v.name));
  if (same.length) return same[0];
  const added = leads.add(biz.id, { name: v.name, phone, note: v.note ?? null, source: v.source });
  return phoneChanged(biz, added.id) ?? added;
}
