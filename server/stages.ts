/**
 * Mijoz bosqichi o'zi o'zgaradigan joylar (G3) — egasi qo'lda surmasa ham ro'yxat haqiqatga mos tursin:
 *   revive       — «Yo'qotildi»dagi mijoz yana o'zi yozdi yoki qo'ng'iroq qildi: faol ro'yxatga («Gaplashildi») qaytadi;
 *   markVisited  — DentaCRM'da qabulga kelgan (Completed / Checked-In) yoki to'lagan bemor: «Mijoz bo'ldi» — «unutilgan»ga tushmaydi;
 *   giveUpSilent — ketma-ket SILENT_LIMIT marta yozildi, javob yo'q: «Yo'qotildi» — ertalabki reja unga har kuni xabar
 *                  tayyorlamaydi (yana yozsa — revive qaytaradi).
 * Qabul yozilganda «Mijoz bo'ldi» — inbox/core.ts (linkBooked) va phone/index.ts (qo'ng'iroq tahlili).
 */
import { inbox, leads, type BusinessRow, type LeadRow } from './db';
import { optOuts } from './serviceStore';
import { CAME, type Appointment, type Transaction } from './crm/logic';
import { withCrm } from './crm/index';
import { isHold } from './inbox/hold';
import { SILENT_LIMIT, idleDays } from './plan';
import { iso } from '../src/lib/week';

const DAY_MS = 86_400_000;

/**
 * Mijoz o'zi bog'landi: «Yo'qotildi»da bo'lsa — faol ro'yxatga qaytadi. «Mijoz bo'ldi» o'zgarmaydi (u bizning bemorimiz).
 * Avval «yozmang» degan bo'lsa ham — belgi olinadi: endi u o'zi gaplashmoqchi
 */
export function revive(biz: BusinessRow, lead: LeadRow): LeadRow {
  optOuts.remove(biz.id, lead.id);
  if (lead.stage !== 'lost') return lead;
  return leads.update(biz.id, lead.id, { stage: 'contacted' }) ?? lead;
}

/**
 * «Boshqa yozmang», «bezovta qilmang», «не пишите»… — mijoz xabar olishni xohlamaydi (E10). Faqat yozishga oid: «qo'ng'iroq qilmang»
 * ichiga olinmaydi (u «yozing» degani bo'lishi mumkin)
 */
const NO_MESSAGES = /(yozma(ng|nglar)\b|xabar\s+yuborma(ng|nglar)\b|bezovta\s+qilma(ng|nglar)\b|ёзма(нг|нглар)|безовта\s+қилма(нг|нглар)|не\s+пиши(те)?(\s|$|[.,!])|не\s+беспоко(й|йте)(\s|$|[.,!])|отпиши(те)?\s+меня|удалите\s+(мой\s+номер|меня))/iu;
export const wantsNoMessages = (text: string): boolean => NO_MESSAGES.test(text.replace(/[ʻʼ’‘`´]/g, "'"));

/** Mijozning yangi xabari: «yozmang» — belgi va «Yo'qotildi» (unga qayta yozish tayyorlanmaydi); boshqasi — revive */
export function customerWrote(biz: BusinessRow, lead: LeadRow, text: string): LeadRow {
  if (!wantsNoMessages(text)) return revive(biz, lead);
  optOuts.mark(biz.id, lead.id);
  return leads.update(biz.id, lead.id, { stage: 'lost' }) ?? lead;
}

/** Kelgan yoki to'lagan bemorlarning hali «Mijoz bo'ldi» bo'lmagan kartalari — «Mijoz bo'ldi». Qaytadi: nechta karta o'zgardi */
export function markVisited(biz: BusinessRow, day: { appointments: Appointment[]; transactions?: Transaction[] }): number {
  const ids = new Set([
    ...day.appointments.filter(a => CAME.has(a.status)).map(a => a.patientId),
    ...(day.transactions ?? []).filter(t => t.status === 'Paid').map(t => t.patientId),
  ].filter((id): id is string => !!id));
  let changed = 0;
  for (const id of ids) {
    for (const l of leads.ofPatient(biz.id, id)) {
      if (l.stage === 'won') continue;
      leads.update(biz.id, l.id, { stage: 'won' });
      changed++;
    }
  }
  return changed;
}

/** DentaCRM'dan bugungi va kechagi kun: kechqurun kompyuter o'chiq bo'lsa ham kechagi kelganlar yo'qolmaydi */
export async function syncVisits(biz: BusinessRow, now = new Date()): Promise<number> {
  const days = [iso(new Date(now.getTime() - DAY_MS)), iso(now)];
  let changed = 0;
  for (const date of days) changed += markVisited(biz, await withCrm(biz.id, crm => crm.day(date)));
  return changed;
}

/**
 * Javobsiz mijozlar: oxirgi SILENT_LIMIT xabar — bizniki (javob yo'q; avtomatik «xodimiga yetkazildi» sanalmaydi) va followDays
 * kundan beri jim. Egasi o'zi keyingi qadam qo'ygan bo'lsa (nextAt) — tegilmaydi. Qaytadi: «Yo'qotildi»ga o'tkazilganlar (ertalabki rejada aytiladi)
 */
export function giveUpSilent(biz: BusinessRow, now: Date, followDays: number): LeadRow[] {
  const gave: LeadRow[] = [];
  for (const l of leads.active(biz.id)) {
    if (l.stage !== 'contacted' || l.nextAt || idleDays(l, now) < Math.max(1, followDays)) continue;
    const thread = inbox.thread(biz.id, l.id, 30).filter(m => !isHold(m));
    const tail = thread.slice(-SILENT_LIMIT);
    if (tail.length < SILENT_LIMIT || tail.some(m => m.direction !== 'out')) continue;
    const lost = leads.update(biz.id, l.id, { stage: 'lost' });
    if (lost) gave.push(lost);
  }
  return gave;
}
