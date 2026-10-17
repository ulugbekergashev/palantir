/**
 * DentaCRM'ni to'g'ridan-to'g'ri tekshirish (yordamchisiz): klinika, shifokorlar jadvali, bir kunning qabullari va tushumi, bo'sh vaqtlar.
 * O'rnatishda "CRM nimani qaytaryapti?" degan savolga javob. Hech narsa yozmaydi.
 *   CRM_URL=… CRM_USER=… CRM_PASS=… [CRM_DATES=2026-10-01,2026-10-02] npx tsx scripts/crm-probe.ts
 */
process.env.TZ = 'Asia/Tashkent';
import { iso, stamp } from '../src/lib/week';
import { createDentaCrm } from '../server/crm/dentacrm';
import { dayOff, daySummary, doctorName, freeSlots, normalizeBaseUrl } from '../server/crm/logic';

const { CRM_URL, CRM_USER, CRM_PASS } = process.env;
if (!CRM_URL || !CRM_USER || !CRM_PASS) { console.error('CRM_URL, CRM_USER va CRM_PASS kerak'); process.exit(2); }

const crm = createDentaCrm({ baseUrl: normalizeBaseUrl(CRM_URL), username: CRM_USER, password: CRM_PASS });
const who = await crm.login();
const clinic = await crm.clinic();
console.log(`Klinika: ${clinic.name} (${who.role}), ish vaqti ${clinic.startHour}:00–${clinic.endHour}:00, dam olish: ${JSON.stringify(clinic.daysOff)}`);
const doctors = await crm.doctors();
for (const d of doctors) console.log(`Shifokor: ${doctorName(d)} [${d.status}] soat ${d.startHour ?? '—'}–${d.endHour ?? '—'} jadval ${JSON.stringify(d.off)}`);
console.log(`Bemorlar: ${(await crm.patients()).length} ta`);

const now = stamp(new Date());
const dates = (process.env.CRM_DATES || `${iso(new Date())},${iso(new Date(Date.now() + 86_400_000))}`).split(',');
for (const date of dates) {
  const [appointments, transactions] = await Promise.all([crm.appointments(date), crm.transactions(date)]);
  const s = daySummary(appointments, transactions);
  console.log(`\n${date}: ${s.total} qabul (${JSON.stringify(s.by_status)}), tushum ${s.revenue.total} ${JSON.stringify(s.revenue.by_method)}, avans ${s.revenue.advance}, balansdan ${s.revenue.from_balance}, to'lanmagan ${s.unpaid.total}`);
  for (const doctor of doctors) {
    const slots = freeSlots({ appointments, doctor, clinic, date, duration: 30, now });
    console.log(`  ${doctorName(doctor)}: ${slots.length} bo'sh ${slots.length ? `(${slots.join(' ')})` : ''}${dayOff(doctor, clinic, date) ? ` — ${dayOff(doctor, clinic, date)}` : ''}`);
  }
}
