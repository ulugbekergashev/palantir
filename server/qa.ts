/**
 * Egasining savoliga javob: "Nechta odam yozildi?", "Qaysi post yaxshi ishladi?".
 * Raqamlar bazadan (haqiqiy); gapni AI tuzadi, AI bo'lmasa — oddiy shablon.
 */
import { addDays, fromIso, iso, whenLabel } from '../src/lib/week';
import { answerOwner } from './ai';
import { leads, type ClinicRow } from './db';
import { thisMonday, viewWeek } from './content';

const STATUS_UZ = { pending: 'tasdiq kutilmoqda', published: 'tasdiqlangan', rejected: 'kerak emas' } as const;

export function weekNumbers(clinic: ClinicRow, monday: string) {
  const view = viewWeek(clinic, monday);
  const counts = leads.countsForWeek(clinic.id, monday);
  const rows = view.items.map(it => ({
    id: it.id,
    what: `${it.kind === 'story' ? 'Storis' : 'Post'} · ${it.topic.uz}: ${it.design.uz.title}`,
    when: whenLabel('uz', it.date, it.time),
    status: view.meta[it.id].publishedAt ? 'chiqdi' : STATUS_UZ[view.status[it.id]],
    clicks: counts[it.id]?.clicks ?? 0,
    contacts: counts[it.id]?.contacts ?? 0,
  }));
  return {
    rows,
    clicks: rows.reduce((s, r) => s + r.clicks, 0),
    contacts: rows.reduce((s, r) => s + r.contacts, 0),
  };
}

export async function answerQuestion(clinic: ClinicRow, question: string): Promise<string> {
  const monday = thisMonday();
  const prevMonday = iso(addDays(fromIso(monday), -7));
  const cur = weekNumbers(clinic, monday);
  const prev = weekNumbers(clinic, prevMonday);
  const recent = leads.forClinic(clinic.id, 50).filter(l => Date.now() - Date.parse(l.createdAt) < 7 * 86_400_000);

  const ai = await answerOwner(question, {
    clinic: clinic.profile.name,
    this_week: { monday, posts: cur.rows, booking_link_clicks: cur.clicks, left_phone_number: cur.contacts },
    last_week: { monday: prevMonday, posts: prev.rows, booking_link_clicks: prev.clicks, left_phone_number: prev.contacts },
    leads_last_7_days: recent.length,
    channel_connected: !!clinic.channelId,
  });
  if (ai) return ai;

  const q = question.toLowerCase().replace(/[‘’ʻʼ`]/g, "'");
  if (/lid|yozil|murojaat|raqam|odam|mijoz|заяв|лид|клиент/.test(q)) {
    return `Bu hafta: ${cur.clicks} kishi postdagi havolani bosdi, ${cur.contacts} kishi raqam qoldirdi.\nO'tgan hafta: ${prev.clicks} bosish, ${prev.contacts} raqam.`;
  }
  if (/qaysi|yaxshi|eng |natija|лучш|результат/.test(q)) {
    const src = cur.clicks ? cur : prev;
    const best = [...src.rows].sort((a, b) => b.contacts - a.contacts || b.clicks - a.clicks)[0];
    if (!best || !best.clicks) return "Hali hech kim havolani bosmadi — postlar chiqqach natijani ko'rsataman.";
    return `${src === cur ? 'Bu hafta' : "O'tgan hafta"} eng yaxshisi — «${best.what}»: ${best.clicks} bosish, ${best.contacts} raqam.`;
  }
  return "Men haftalik postlar va ular orqali kelgan murojaatlar haqida javob beraman. Masalan: «Nechta odam yozildi?» yoki «Qaysi post yaxshi ishladi?»";
}
