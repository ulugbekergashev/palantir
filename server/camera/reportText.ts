/**
 * Kechki kamera hisobotining matni — sof (baza yo'q): kunlik kamera hisobidan egasiga o'qiladigan qisqa HTML.
 * Yuborish va kuniga bir marta — report.ts.
 */
import type { CameraSummary } from '../../src/types';
import { hoursMin } from '../../src/lib/zones';

const MAX_FINDINGS = 6;
const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clock = (at: string) => new Date(at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Hisobot matni (HTML). alerts — bugungi kamera ogohlantirishlari soni. Aytadigan narsa yo'q bo'lsa — null */
export function reportHtml(s: CameraSummary, alerts: number, now = new Date()): string | null {
  const lines: string[] = [];
  const crm = s.crm;
  if (s.seated || crm) lines.push(`🪑 Kresloga o'tirdi: <b>${s.seated}</b> bemor${crm ? ` (DentaCRM'da «keldi»: ${crm.visits})` : ''}`);
  if (s.deskVisits || crm) lines.push(`💳 Kassa oldida: <b>${s.deskVisits}</b> marta${crm ? ` (to'lov yozilgan: ${crm.payments})` : ''}`);
  const used = (s.chairUse ?? []).filter(c => c.pct !== null);
  if (used.length) lines.push(`⏱ Kreslo bandligi: ${used.map(c => `${esc(c.name)} — ${c.pct}%`).join(', ')}`);
  const w = s.waiting;
  if (w?.count) lines.push(`🛋 Kutish: ${w.count} kishi, o'rtacha ${hoursMin(w.avgMin)}, eng uzog'i ${hoursMin(w.maxMin)}${w.longCount ? ` — ${w.longCount} kishi ${w.alertMin} daqiqadan ko'p` : ''}`);
  for (const a of s.attendance ?? []) {
    lines.push(a.firstAt
      ? `👤 ${esc(a.name)}: ${clock(a.firstAt)} keldi, ${a.here || !a.lastAt ? 'hali joyida' : `${clock(a.lastAt)} ketdi`}, joyida ${hoursMin(a.presentMin)}${a.longestAway ? `; eng uzoq yo'qligi ${hoursMin(a.longestAway.min)}` : ''}`
      : `👤 ${esc(a.name)}: bugun joyida ko'rinmadi`);
  }
  const problems = s.findings.filter(f => f.level !== 'ok');
  if (problems.length) {
    lines.push('', `⚠️ <b>Tekshiring</b> (${problems.length}):`, ...problems.slice(0, MAX_FINDINGS).map(f => `• ${esc(f.text)}`));
    if (problems.length > MAX_FINDINGS) lines.push(`• … yana ${problems.length - MAX_FINDINGS} ta — panelda`);
  }
  if (alerts) lines.push('', `🔔 Bugun kamera ${alerts} marta ogohlantirdi — Kuzatuvchi jurnalida kadrlari bilan.`);
  if (!lines.length) return null;
  return [`📷 <b>Kameralar — bugun, ${now.getDate()}-${MONTHS[now.getMonth()]}</b>`, '', ...lines].join('\n');
}
