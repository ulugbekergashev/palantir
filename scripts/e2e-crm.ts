/**
 * DentaCRM ulanishi sinovlari (e2e.ts ichidan chaqiriladi):
 *   hisob-kitob qoidalari — to'g'ridan-to'g'ri (server/crm/logic.ts, tashqi dunyosiz);
 *   ulash, asboblar, token eskirishi, bizneslar orasidagi devor — soxta DentaCRM bilan (scripts/fakeCrm.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { iso } from '../src/lib/week';
import { CrmError, createDentaCrm } from '../server/crm/dentacrm';
import { bookingProblem, briefLine, dayOff, daySummary, freeSlots, cleanName, hasFullName, isRealDate, normPhone, resolvePatient, slotRanges, normalizeBaseUrl, parseDaysOff, parseDoctorOff, searchPatients, type Appointment, type Clinic, type Doctor, type Patient, type Transaction } from '../server/crm/logic';
import { clinicAlerts, comparisonRange, datesBetween, periodRange, periodReport, previousRange, spanDays, type DayData } from '../server/crm/report';
import { payoutCategory, summarize } from '../server/crm/money';
import { findLocalCrm } from '../server/crm/find';
import { CRM_HASH, CRM_LOGIN, crm } from './fakeCrm';
import { OWNER, ai, press, say, sent, sleep, waitFor, type Sent } from './fakes';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Harness {
  ok: (name: string, cond: unknown, info?: string) => void;
  api: (path: string, opts?: { method?: string; token?: string; body?: unknown }) => Promise<{ status: number; json: Json }>;
  base: string;
  token: string;
  otherToken: string;
  dataDir: string;
  crmPort: number;
  serverLog: () => string;
}

const days = () => ({ today: iso(new Date()), tomorrow: iso(new Date(Date.now() + 86_400_000)), yesterday: iso(new Date(Date.now() - 86_400_000)) });
const throws = (fn: () => unknown) => { try { fn(); return false; } catch { return true; } };

/** Sof qoidalar: bo'sh vaqt, band vaqt, tushum, qidiruv, manzil */
export function crmLogicTests(ok: Harness['ok']): void {
  console.log('\n# DentaCRM: hisob-kitob qoidalari');
  const { today, tomorrow, yesterday } = days();
  crm.seed(today, tomorrow);
  const appts = crm.appointments as unknown as Appointment[];
  const clinic: Clinic = { id: 'c1', name: 'Tabassum Dental', startHour: 8, endHour: 20 };
  const d1: Doctor = { id: 'd1', firstName: 'Rustam', lastName: 'Rustamov', specialty: 'Terapevt', status: 'Active', startHour: 9, endHour: 18 };
  const on = (date: string) => appts.filter(a => a.date === date);

  const s = daySummary(on(today), crm.transactions as unknown as Transaction[]);
  ok('kun: 6 qabul — 2 keldi, 1 kelmadi, 1 bekor, 2 kutilmoqda', s.total === 6 && s.came === 2 && s.no_show === 1 && s.cancelled === 1 && s.expected === 2, JSON.stringify({ ...s, doctors: undefined }));
  ok("tushum: 950 000 (balansdan to'lov yangi pul emas), usullar bo'yicha", s.revenue.total === 950_000 && s.revenue.by_method.Cash === 300_000 && s.revenue.by_method.Card === 500_000 && s.revenue.by_method.Click === 150_000);
  ok("avans 150 000, balansdan 200 000, to'lanmagan 500 000 (2 ta)", s.revenue.advance === 150_000 && s.revenue.from_balance === 200_000 && s.unpaid.total === 500_000 && s.unpaid.count === 2);
  ok("shifokorlar bo'yicha: Rustamov 4, Aliyeva 2", s.doctors.find(d => d.doctor_id === 'd1')?.count === 4 && s.doctors.find(d => d.doctor_id === 'd2')?.count === 2);

  const slots = freeSlots({ appointments: on(tomorrow), doctor: d1, clinic, date: tomorrow, duration: 30, now: `${today}T12:00` });
  ok("bo'sh vaqt: shifokor soatlari ichida, band vaqtlarsiz (16 ta)", slots.length === 16 && slots[0] === '09:00' && slots.at(-1) === '17:30' && !slots.includes('10:00') && !slots.includes('10:30'), slots.join(' '));
  ok("bekor qilingan qabul vaqti bo'sh hisoblanadi", slots.includes('11:30') && slots.includes('11:00'));
  const todaySlots = freeSlots({ appointments: on(today), doctor: d1, clinic, date: today, duration: 30, now: `${today}T15:10` });
  ok("bugun: o'tib ketgan vaqt taklif qilinmaydi", todaySlots.length > 0 && todaySlots.every(t => t > '15:10'), todaySlots.join(' '));
  ok("kechagi kunga bo'sh vaqt yo'q", freeSlots({ appointments: [], doctor: d1, clinic, date: yesterday, duration: 30, now: `${today}T10:00` }).length === 0);

  const problem = (patientId: string | null, date: string, time: string, duration = 30) =>
    bookingProblem({ appointments: on(date), doctor: d1, clinic, patientId, date, time, duration, now: `${today}T08:00` });
  ok("yozish: bo'sh vaqtga — muammo yo'q", problem('p3', tomorrow, '11:30') === null);
  ok('yozish: band vaqt rad etiladi', !!problem('p3', tomorrow, '10:30')?.includes('band'), problem('p3', tomorrow, '10:30') ?? '');
  ok('yozish: ish vaqtidan tashqari rad etiladi', !!problem('p3', tomorrow, '17:45') && !!problem('p3', tomorrow, '08:00'));
  ok("yozish: o'tgan sana rad etiladi", !!problem('p3', yesterday, '11:00'));
  ok('yozish: bemor shu kuni yozilgan bo\'lsa — vaqti aytiladi', !!problem('p1', tomorrow, '15:00')?.includes('10:00'), problem('p1', tomorrow, '15:00') ?? '');
  const soon = (time: string) => bookingProblem({ appointments: [], doctor: d1, clinic, patientId: null, date: today, time, duration: 30, now: `${today}T12:00`, minLeadMin: 60 });
  ok('yozish (resepshn): juda yaqin vaqtga yozilmaydi', !!soon('12:30') && soon('13:30') === null);
  ok("yozish: bugun o'tib ketgan soat rad etiladi", !!bookingProblem({ appointments: [], doctor: d1, clinic, patientId: 'p3', date: today, time: '11:00', duration: 30, now: `${today}T12:00` })?.includes("o'tib ketgan"));
  const far = `${Number(today.slice(0, 4)) + 3}${today.slice(4)}`;
  ok('yozish: juda uzoq sana rad etiladi', !!bookingProblem({ appointments: [], doctor: d1, clinic, patientId: 'p3', date: far, time: '11:00', duration: 30, now: `${today}T12:00` }));
  ok("sana: taqvimda yo'q kun (31-fevral, 13-oy) rad etiladi", isRealDate(today) && !isRealDate('2026-02-31') && !isRealDate('2026-13-01') && !isRealDate('2026-1-5'));
  ok("to'lanmagan: faqat kutilayotgan va muddati o'tgan (bekor qilingani emas)", daySummary([], [{ id: 'x', patientName: '', amount: 700, type: 'Cash', service: null, status: 'Cancelled', doctorId: null, doctorName: null }]).unpaid.total === 0);

  // Shifokorning ishlamaydigan vaqtlari va klinikaning dam olish kunlari (lokal DentaCRM qoidasi)
  const [ty, tm, td] = tomorrow.split('-').map(Number);
  const wd = new Date(ty, tm - 1, td).getDay();
  const slotsOf = (doctor: Doctor, c: Clinic = clinic) => freeSlots({ appointments: [], doctor, clinic: c, date: tomorrow, duration: 30, now: `${today}T08:00` });
  const why = (doctor: Doctor, time: string, c: Clinic = clinic) => bookingProblem({ appointments: [], doctor, clinic: c, patientId: 'p3', date: tomorrow, time, duration: 30, now: `${today}T08:00` });
  const weekly: Doctor = { ...d1, off: parseDoctorOff({ weekdays: [wd], blocks: [] }) };
  ok('jadval: shifokorning haftalik dam olish kuni — vaqt yo\'q, yozilmaydi', slotsOf(weekly).length === 0 && !!why(weekly, '11:00')?.includes('dam olish') && !!dayOff(weekly, clinic, tomorrow), why(weekly, '11:00') ?? '');
  const away: Doctor = { ...d1, off: parseDoctorOff(JSON.stringify({ weekdays: [], blocks: [{ id: 'x', dateFrom: today, dateTo: tomorrow, timeFrom: '13:00', timeTo: '15:00', note: 'seminar' }] })) };
  ok('jadval: bir necha soatga band — shu oraliq taklif qilinmaydi, sababi aytiladi', slotsOf(away).includes('12:30') && !slotsOf(away).includes('13:00') && !slotsOf(away).includes('14:30') && slotsOf(away).includes('15:00')
    && !!why(away, '12:45')?.includes('seminar') && why(away, '15:00') === null && dayOff(away, clinic, tomorrow) === null, why(away, '12:45') ?? '');
  const vacation: Doctor = { ...d1, off: parseDoctorOff({ blocks: [{ dateFrom: today, dateTo: tomorrow }] }) };
  ok('jadval: kun bo\'yi ta\'til — vaqt yo\'q', slotsOf(vacation).length === 0 && !!why(vacation, '10:00'));
  const custom: Doctor = { ...d1, off: parseDoctorOff({ weekdays: [], blocks: [], workHours: { [wd]: { from: '10:00', to: '14:00' } } }) };
  ok('jadval: shu kunning o\'z ish soatlari', slotsOf(custom)[0] === '10:00' && slotsOf(custom).at(-1) === '13:30' && !!why(custom, '09:00')?.includes('10:00') && why(custom, '13:30') === null, slotsOf(custom).join(' '));
  const closed: Clinic = { ...clinic, daysOff: parseDaysOff(JSON.stringify({ daysOff: { weekdays: [], dates: [tomorrow] } })) };
  ok('jadval: klinikaning dam olish kuni', slotsOf(d1, closed).length === 0 && !!why(d1, '11:00', closed)?.includes('klinika') && !!dayOff(d1, closed, tomorrow));
  ok('jadval: buzuq yozuv ishni to\'xtatmaydi', parseDoctorOff('{buzuq') === null && parseDoctorOff({ weekdays: ['x', 9], blocks: [{ dateFrom: 'kecha' }, null] })?.blocks.length === 0 && parseDaysOff('yo\'q') === undefined && slotsOf({ ...d1, off: null }).length === 18);

  ok("telefon: 9 xonali mahalliy raqam +998 bilan to'ldiriladi, chala raqam rad etiladi", normPhone('90 111 00 11') === '+998901110011' && normPhone('+998 (93) 222-33-44') === '+998932223344'
    && normPhone('8 901 234 56 78') === '+89012345678' && normPhone('12345') === '' && normPhone('telefonim yo\'q') === '');
  ok('telefon: 0 yoki 8 bilan boshlangan mahalliy yozuv ham +998 ga keltiriladi', normPhone('8 90 123 45 67') === '+998901234567' && normPhone('0901234567') === '+998901234567');
  ok("ism: apostrofning har xil ko'rinishi bitta bo'ladi, ortiqcha belgi tashlanadi", cleanName('O‘ktam  G`ulomov (oʻg’li) 2') === "O'ktam G'ulomov o'g'li"
    && hasFullName('Vali Valiyev') && !hasFullName('Vali') && !hasFullName("'''' ''''") && !hasFullName('A B'));
  const family = [{ id: 'f1', firstName: 'Bobur', lastName: 'Karimov', phone: '+998 90 500 60 70' }, { id: 'f2', firstName: 'Aziz', lastName: 'Karimov', phone: '998905006070' },
    { id: 'f3', firstName: 'Oʻktam', lastName: 'Valiyev', phone: '+998911111111' }].map(p => ({ ...p, secondaryPhone: null, lastVisit: null, balance: 0 }));
  const who = (name: string, phone: string) => resolvePatient(family, name, phone);
  ok('oilaviy telefon: ismi to\'liq mos kelgan a\'zo tanlanadi', who('Aziz Karimov', '+998905006070').patient?.id === 'f2' && who('Karimov Bobur', '905006070').patient?.id === 'f1' && who("O'ktam Valiyev", '+998911111111').patient?.id === 'f3');
  ok('telefon bor, ism boshqa (bitta so\'z mos kelishi yetmaydi) — bemor tanlanmaydi, kimlar borligi aytiladi', who('Jasur Karimov', '+998905006070').patient === null
    && who('Jasur Karimov', '+998905006070').others.join() === 'Bobur Karimov,Aziz Karimov' && who('Yangi Odam', '+998900000009').others.length === 0);
  ok("apostrofli ism: bazaga qanday yozilgan bo'lsa ham o'sha bemor topiladi", who('O‘ktam Valiyev', '911111111').patient?.id === 'f3' && who('Valiyev O`ktam', '+998911111111').patient?.id === 'f3'
    && resolvePatient([{ ...family[0], id: 'g1', firstName: "G'ulom", lastName: 'Rahimov' }], 'G‘ulom Rahimov', '+998905006070').patient?.id === 'g1');

  const list = crm.patients as unknown as Patient[];
  ok('bemor qidirish: familiya bo\'yicha', searchPatients(list, 'valiyev').total === 2);
  ok("bemor qidirish: o' ning har xil yozilishi", searchPatients(list, "o'ktam").matches[0]?.id === 'p3' && searchPatients(list, 'O`ktam karimov').matches[0]?.id === 'p3');
  ok('bemor qidirish: telefon oxirgi raqamlari', searchPatients(list, '901112233').matches[0]?.id === 'p1' && searchPatients(list, '+998 (93) 222-33-44').matches[0]?.id === 'p2');
  ok("bemor qidirish: ko'pi bilan 10 ta, jami soni bilan", searchPatients(list, 'bemor').matches.length === 10 && searchPatients(list, 'bemor').total === 2000);
  ok("bo'sh vaqtlar oraliq qilib yoziladi", slotRanges(['09:00', '09:30', '11:00', '11:30', '12:00', '15:00']) === '09:00–09:30, 11:00–12:00, 15:00' && slotRanges([]) === '');
  ok('ertalabki xulosa qatori: 5 ta qabul, birinchisi 09:00', !!briefLine(on(today))?.includes('5 ta qabul') && !!briefLine(on(today))?.includes('09:00') && briefLine([]) === null);

  // Davr hisoboti va ogohlantirishlar (sof hisob)
  const A = (date: string, doctorId: string, status: string, n = 1): Appointment[] => Array.from({ length: n }, (_, i) => ({
    id: `${date}-${doctorId}-${status}-${i}`, patientId: `x${i}`, patientName: 'Bemor', doctorId, doctorName: doctorId === 'd1' ? 'Rustam Rustamov' : 'Nodira Aliyeva', type: "Ko'rik", date, time: '10:00', duration: 30, status, notes: null,
  }));
  const T = (amount: number, doctorId: string | null = 'd1', status = 'Paid', type = 'Cash'): Transaction => ({ id: `t${amount}${doctorId}${status}${type}`, patientName: 'Bemor', amount, type, service: 'Plomba', status, doctorId, doctorName: doctorId === 'd1' ? 'Rustam Rustamov' : doctorId ? 'Nodira Aliyeva' : null });
  const D = (date: string, appointments: Appointment[] = [], transactions: Transaction[] = []): DayData => ({ date, appointments, transactions });
  ok('davr: hafta dushanbadan, oy 1-kundan, bugungacha', JSON.stringify(periodRange('this_week', '2026-10-08')) === '{"from":"2026-10-05","to":"2026-10-08"}' && JSON.stringify(periodRange('last_week', '2026-10-08')) === '{"from":"2026-09-28","to":"2026-10-04"}'
    && JSON.stringify(periodRange('this_month', '2026-10-08')) === '{"from":"2026-10-01","to":"2026-10-08"}' && JSON.stringify(periodRange('last_month', '2026-03-15')) === '{"from":"2026-02-01","to":"2026-02-28"}'
    && JSON.stringify(periodRange('last_7_days', '2026-10-08')) === '{"from":"2026-10-02","to":"2026-10-08"}' && periodRange('last_30_days', '2026-10-08').from === '2026-09-09');
  ok('davr: kunlar ro\'yxati va uzunligi', datesBetween('2026-09-29', '2026-10-02').join() === '2026-09-29,2026-09-30,2026-10-01,2026-10-02' && spanDays('2026-09-29', '2026-10-02') === 4 && spanDays('2026-10-02', '2026-10-02') === 1 && spanDays('0100-01-01', '9999-12-31') > 3_000_000);
  ok('solishtirish: oldingi davr xuddi shu hafta kunlaridan (dushanba-seshanba shanba-yakshanba bilan solishtirilmaydi)', JSON.stringify(previousRange('2026-10-05', '2026-10-06')) === '{"from":"2026-09-28","to":"2026-09-29"}'
    && JSON.stringify(previousRange('2026-10-02', '2026-10-08')) === '{"from":"2026-09-25","to":"2026-10-01"}' && JSON.stringify(previousRange('2026-09-09', '2026-10-08')) === '{"from":"2026-08-05","to":"2026-09-03"}');
  ok("solishtirish: oy — o'tgan oyning shu kunlari bilan; to'liq oy — undan oldingi oy bilan", JSON.stringify(comparisonRange({ from: '2026-10-01', to: '2026-10-08' }, 'this_month')) === '{"from":"2026-09-01","to":"2026-09-08"}'
    && JSON.stringify(comparisonRange({ from: '2026-03-01', to: '2026-03-31' }, 'last_month')) === '{"from":"2026-02-01","to":"2026-02-28"}' && JSON.stringify(comparisonRange({ from: '2026-01-01', to: '2026-01-15' }, 'this_month')) === '{"from":"2025-12-01","to":"2025-12-15"}'
    && JSON.stringify(comparisonRange({ from: '2026-10-05', to: '2026-10-06' }, 'this_week')) === '{"from":"2026-09-28","to":"2026-09-29"}');
  const week = [
    D('2026-10-05', [...A('2026-10-05', 'd1', 'Completed', 3), ...A('2026-10-05', 'd2', 'No-Show', 1)], [T(600_000), T(200_000, 'd2', 'Paid', 'Card'), T(100_000, 'd1', 'Paid', 'Balance')]),
    D('2026-10-06', [...A('2026-10-06', 'd2', 'Completed', 2), ...A('2026-10-06', 'd1', 'Cancelled', 1)], [T(900_000, 'd2'), T(300_000, null, 'Pending')]),
    D('2026-10-07'),
  ];
  const rep = periodReport(week, [D('2026-10-02', A('2026-10-02', 'd1', 'Completed', 2), [T(1_000_000)]), D('2026-10-03'), D('2026-10-04')]);
  ok('davr hisoboti: jami qabul, kelgan, kelmagan, tushum (balansdan to\'lovsiz), qarz', rep.from === '2026-10-05' && rep.to === '2026-10-07' && rep.days === 3 && rep.appointments.total === 7 && rep.appointments.came === 5 && rep.appointments.no_show === 1
    && rep.appointments.cancelled === 1 && rep.appointments.show_rate_pct === 83 && rep.revenue.total === 1_700_000 && rep.revenue.by_method.Card === 200_000 && rep.revenue.per_day_avg === 566_667 && rep.unpaid.total === 300_000, JSON.stringify({ ...rep, by_day: undefined, doctors: undefined }));
  ok('davr hisoboti: shifokorlar tushum bo\'yicha tartibda, kunlar bo\'yicha, eng yaxshi kun', rep.doctors[0].doctor === 'Nodira Aliyeva' && rep.doctors[0].revenue === 1_100_000 && rep.doctors[0].came === 2 && rep.doctors[0].no_show === 1
    && rep.doctors[1].revenue === 600_000 && rep.doctors[1].appointments === 4 && rep.by_day.length === 3 && rep.by_day[1].revenue === 900_000 && rep.by_day[2].appointments === 0 && rep.best_day?.date === '2026-10-06');
  ok('davr hisoboti: oldingi davr bilan solishtiradi', rep.previous?.revenue === 1_000_000 && rep.previous.from === '2026-10-02' && rep.previous.change_pct.revenue === 70 && rep.previous.change_pct.appointments === 250 && periodReport(week).previous === null
    && periodReport(week, [D('2026-10-04')]).previous?.change_pct.revenue === null);
  const paidAs = (salaryType?: string) => payoutCategory({ ...d1, salaryType });
  ok("shifokorga to'lov turi: foizli va lokal nashr — ulush, belgilangan — oylik, aralash — yozilmaydi (ikkiga bo'linadi)", JSON.stringify(paidAs('kpi')) === '{"category":"DoctorShare","warning":null}' && JSON.stringify(paidAs()) === '{"category":"DoctorShare","warning":null}'
    && JSON.stringify(paidAs('fixed')) === '{"category":"Salary","warning":null}' && 'problem' in paidAs('fixed_kpi') && 'warning' in paidAs('none') && !!(paidAs('none') as { warning: string | null }).warning);
  const shown = summarize({ kind: 'payment', patientId: 'p1', patientName: 'Ali Valiyev', patientPhone: '+998 90 111 22 33', doctorId: 'd1', doctorName: 'Rustam Rustamov', service: 'Plomba', amount: 1_250_000, method: 'Click', date: '2026-10-08' });
  ok("pul yozuvi kartasi: summa, bemor, xizmat, shifokor, usul, sana", shown.title === "To'lov qabul qilish: 1 250 000 so'm" && shown.details.join('|') === 'Bemor: Ali Valiyev (tel. …2233)|Xizmat: Plomba|Shifokor: Rustam Rustamov|Usul: Click|Sana: 2026-10-08'
    && summarize({ kind: 'payout', doctorId: 'd1', doctorName: 'R', category: 'Salary', title: 't', warning: 'Maosh turi belgilanmagan', amount: 5, method: 'Cash', date: '2026-10-08' }).details.some(d => d.includes('Maosh turi belgilanmagan')));
  const usual = (date: string) => D(date, A(date, 'd1', 'Completed', 10), [T(2_000_000)]);
  const before = ['2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30'].map(usual);
  const calm = { yesterday: usual('2026-10-07'), today: D('2026-10-08', A('2026-10-08', 'd1', 'Confirmed', 9)), yesterdayBefore: before, todayBefore: before, yesterdayClosed: false, todayClosed: false };
  ok('ogohlantirish: odatdagi kun — hech narsa', clinicAlerts(calm).length === 0, clinicAlerts(calm).join(' | '));
  const bad = clinicAlerts({ ...calm,
    yesterday: D('2026-10-07', [...A('2026-10-07', 'd1', 'Completed', 4), ...A('2026-10-07', 'd1', 'No-Show', 3), ...A('2026-10-07', 'd2', 'Cancelled', 5), ...A('2026-10-07', 'd2', 'Pending', 3)], [T(450_000), T(700_000, 'd1', 'Pending'), T(300_000, 'd2', 'Overdue')]),
    today: D('2026-10-08', A('2026-10-08', 'd1', 'Confirmed', 3)) });
  ok("ogohlantirish: tushum keskin kam, ko'p kelmagan, ko'p bekor, belgilanmagan qabullar, qarz, bo'sh jadval", bad.length === 6 && bad[0].includes('tushum') && bad[0].includes('78%') && bad[0].includes('450 000') && bad.some(a => a.includes('3 ta bemor kelmadi'))
    && bad.some(a => a.includes('5 ta qabul bekor')) && bad.some(a => a.includes('belgilanmagan')) && bad.some(a => a.includes("1 000 000")) && bad.some(a => a.includes('Bugun') && a.includes('3 ta')), bad.join(' | '));
  const holidays = [D('2026-09-09'), D('2026-09-16'), usual('2026-09-23'), usual('2026-09-30')];
  ok("ogohlantirish: tarixdagi bo'sh kunlar (dam olish, bayram) odatdagi darajani pasaytirmaydi; qarzsiz «0 so'm qarz» demaydi", clinicAlerts({ ...calm, yesterdayBefore: [D('2026-09-09'), ...before.slice(1)], yesterday: D('2026-10-07', A('2026-10-07', 'd1', 'Completed', 5), [T(900_000)]) })[0]?.includes('2 000 000')
    && clinicAlerts({ ...calm, yesterdayBefore: holidays, todayBefore: holidays, yesterday: D('2026-10-07', A('2026-10-07', 'd1', 'Completed', 2), [T(100_000), T(0, 'd1', 'Pending'), T(0, 'd2', 'Pending')]), today: D('2026-10-08') }).length === 0);
  const renamed = periodReport([D('2026-10-05', [{ ...A('2026-10-05', 'd1', 'Completed')[0], doctorName: '' }], [T(500_000)])]);
  ok("davr hisoboti: qabulda shifokor ismi bo'sh bo'lsa, to'lovdagi ism olinadi", renamed.doctors.length === 1 && renamed.doctors[0].doctor === 'Rustam Rustamov' && renamed.doctors[0].revenue === 500_000);
  ok("ogohlantirish: dam olish kuni va tarixi yo'q klinika — jim", clinicAlerts({ ...calm, yesterday: D('2026-10-07'), today: D('2026-10-08'), yesterdayClosed: true, todayClosed: true }).length === 0
    && clinicAlerts({ ...calm, yesterday: D('2026-10-07'), today: D('2026-10-08'), yesterdayBefore: before.slice(0, 2), todayBefore: [] }).length === 0);

  ok('manzil: lokal tarmoqda http, internetda faqat https', normalizeBaseUrl('http://192.168.1.20:3001/login') === 'http://192.168.1.20:3001'
    && normalizeBaseUrl('https://api.dentacrm.uz/api/') === 'https://api.dentacrm.uz' && normalizeBaseUrl('localhost:3005') === 'http://localhost:3005'
    && throws(() => normalizeBaseUrl('http://api.dentacrm.uz')));
  ok('manzil: xavfli ko\'rinishlar rad etiladi', throws(() => normalizeBaseUrl('ftp://192.168.1.2')) && throws(() => normalizeBaseUrl('https://user:pass@dentacrm.uz'))
    && throws(() => normalizeBaseUrl('http://169.254.169.254')) && throws(() => normalizeBaseUrl('http://0.0.0.0:3001')) && throws(() => normalizeBaseUrl('http://metadata.google.internal')) && throws(() => normalizeBaseUrl('   ')));
  const sneaky = ['http://[::ffff:169.254.169.254]', 'http://[fd00:ec2::254]', 'http://[2001:4860:4860::8888]', 'http://[::ffff:8.8.8.8]', 'http://10.evil.com', 'http://127.attacker.com:8080',
    'http://192.168.evil.com', 'http://172.16.evil.com', 'http://metadata', 'https://metadata.google.internal.', 'http://[fe80::1]'];
  ok("manzil: IPv6 va «lokalga o'xshash» nomlar bilan chetlab o'tib bo'lmaydi", sneaky.every(u => throws(() => normalizeBaseUrl(u))), sneaky.filter(u => !throws(() => normalizeBaseUrl(u))).join(' '));
  ok('manzil: haqiqiy lokal va https manzillar ishlaydi', normalizeBaseUrl('http://[::1]:3001') === 'http://[::1]:3001' && normalizeBaseUrl('http://10.0.0.5:3001') === 'http://10.0.0.5:3001'
    && normalizeBaseUrl('http://denta-pc:3001') === 'http://denta-pc:3001' && normalizeBaseUrl('https://[2001:4860:4860::8888]') === 'https://[2001:4860:4860::8888]' && normalizeBaseUrl('example.com:8080') === 'https://example.com:8080');
  ok("manzil: umumiy serverda (allowPrivate=false) ichki tarmoq yopiq", throws(() => normalizeBaseUrl('http://192.168.1.20:3001', false)) && throws(() => normalizeBaseUrl('localhost:3001', false))
    && throws(() => normalizeBaseUrl('http://denta-pc:3001', false)) && normalizeBaseUrl('https://api.dentacrm.uz', false) === 'https://api.dentacrm.uz');
}

/** Ulash: noto'g'ri parol, manzil, maxfiy narsalar tashqariga chiqmasligi */
export async function crmConnectTests(h: Harness): Promise<void> {
  console.log('\n# DentaCRM: ulash');
  const { ok, api, token } = h;
  const url = `http://127.0.0.1:${h.crmPort}`;
  const st0 = (await api('/api/me', { token })).json.status;
  ok('holat: DentaCRM hali ulanmagan', st0.crm && st0.crm.account === null);
  const bad = await api('/api/crm', { token, body: { url, username: CRM_LOGIN.username, password: 'xato' } });
  ok("noto'g'ri parol — 400, tushunarli sabab", bad.status === 400 && String(bad.json.error).includes("parol noto'g'ri"), bad.json.error);
  const closed = await api('/api/crm', { token, body: { url: 'http://127.0.0.1:1', ...CRM_LOGIN } });
  ok("ishlamayotgan manzil — 400 «ulanib bo'lmadi»", closed.status === 400 && String(closed.json.error).includes("ulanib bo'lmadi"), closed.json.error);
  ok("xavfli manzil — 400", (await api('/api/crm', { token, body: { url: 'ftp://127.0.0.1', ...CRM_LOGIN } })).status === 400
    && (await api('/api/crm', { token, body: { url: 'http://a:b@127.0.0.1:3001', ...CRM_LOGIN } })).status === 400);
  ok('tokensiz ulab bo\'lmaydi — 401', (await api('/api/crm', { body: { url, ...CRM_LOGIN } })).status === 401);
  // Shu kompyuterdagi DentaCRM'ni topish: DentaCRM kabi javob bersa — manzil; boshqa dastur, yopiq port, umumiy server — yo'q
  ok('topish: DentaCRM javob bergan manzil topildi', await findLocalCrm(url) === url);
  ok("topish: boshqa dastur (Palantir'ning o'zi) va yopiq port — topilmadi", await findLocalCrm(h.base) === null && await findLocalCrm('http://127.0.0.1:1') === null);
  ok("topish: umumiy serverda (mahalliy manzil taqiqlangan) so'ralmaydi", await findLocalCrm(url, false) === null);
  const found = await api('/api/crm/find', { token });
  ok('topish: panel yo\'li ishlaydi (bu kompyuterda 3001-portda DentaCRM yo\'q bo\'lsa — null)', found.status === 200 && 'url' in found.json, JSON.stringify(found.json));
  ok("topish: tokensiz — 401", (await api('/api/crm/find')).status === 401);
  // Birinchi urinish CRM javobini kutib turganda ikkinchisi keladi (kechikishsiz bu poyga tasodifga bog'liq edi)
  crm.slowLogin = 600;
  const pair = await Promise.all([1, 2].map(() => api('/api/crm', { token, body: { url, username: CRM_LOGIN.username, password: 'xato' } })));
  ok('bir vaqtda ikki urinish — bittasi kutadi (429)', pair.map(r => r.status).sort().join() === '400,429', pair.map(r => r.status).join());
  const broken = await fetch(`${h.base}/api/crm`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: '{"url":"http://x","username":"u","password":"KANAREYKA-PAROL' });
  await sleep(200);
  ok("buzuq so'rov — 400, parol logga tushmaydi", broken.status === 400 && !h.serverLog().includes('KANAREYKA'), String(broken.status));

  const good = await api('/api/crm', { token, body: { url: `${url}/login`, ...CRM_LOGIN } });
  ok('ulandi: klinika nomi va manzili', good.status === 200 && good.json.status?.crm?.account === `Tabassum Dental · 127.0.0.1:${h.crmPort}`, JSON.stringify(good.json.status?.crm ?? good.json));
  const me = await api('/api/me', { token });
  const leaked = (s: string) => s.includes(CRM_LOGIN.password) || s.includes('jwt-fake-') || s.includes('$2b$');
  ok('javoblarda parol ham, token ham yo\'q', !leaked(JSON.stringify(good.json)) && !leaked(JSON.stringify(me.json)));
  const dbBytes = ['cerebro.db', 'cerebro.db-wal'].map(f => { try { return readFileSync(join(h.dataDir, f)).toString('latin1'); } catch { return ''; } }).join('');
  ok('bazada parol shifrlangan (ochiq matnda yo\'q)', dbBytes.includes('dentacrm') && !dbBytes.includes(CRM_LOGIN.password));
  ok('boshqa biznes: DentaCRM ulanmagan', (await api('/api/me', { token: h.otherToken })).json.status.crm.account === null);
}

/** Resepshn: bemor yozishmada bo'sh vaqtni so'raydi va qabulga yoziladi (bot orqali; shaxsiy Telegram va Instagram ham shu yo'ldan o'tadi) */
export async function crmReceptionTests(h: Harness): Promise<void> {
  console.log('\n# DentaCRM: resepshn — bemor yozishmada qabulga yoziladi');
  const { ok, api, token } = h;
  const { tomorrow } = days();
  const day = (n: number) => iso(new Date(Date.now() + n * 86_400_000));
  const [D3, D4, D5] = [day(3), day(4), day(5)];
  const textOf = (s: Sent) => String(s.params.text ?? s.params.caption ?? '');
  const after = (mark: number, chat: number, pred: (s: Sent) => boolean) => sent.slice(mark).find(s => Number(s.params.chat_id) === chat && pred(s));
  const buttons = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();
  const bizId = String((await api('/api/me', { token })).json.status.generalLink).split('start=l-')[1];
  const [C1, C2, C3] = [7101, 7102, 7103];
  /** Bemor botga havola orqali kiradi */
  const join = async (id: number) => {
    const mark = sent.length;
    say(id, `/start l-${bizId}`);
    await waitFor('bemorga salom', () => after(mark, id, () => true));
  };
  const ask = (id: number, b: Record<string, string>) => say(id, `Meni yozing ${JSON.stringify(b)}`);
  const setMode = (mode: string) => api('/api/business/auto-reply', { method: 'PUT', token, body: { mode, contacts: false, delayMin: 0 } });
  await setMode('draft');

  await join(C1);
  let mark = sent.length;
  say(C1, "Ertaga bo'sh vaqt bormi?");
  const q = await waitFor('savol kartasi', () => after(mark, OWNER, s => textOf(s).includes("Ertaga bo'sh vaqt bormi?")));
  const asked = ai.replier.at(-1)!;
  ok("Claude'ga: shifokorlar va bo'sh vaqtlar CRM'dan (band va dam olish vaqtlarisiz)", asked.user.includes('<clinic_schedule>') && asked.user.includes('doctor_id d1') && asked.user.includes('Rustam Rustamov')
    && new RegExp(`${tomorrow}[^\n]*: 09:00–09:30, 11:00–17:30`).test(asked.user) && new RegExp(`${crm.closedDay}[^\n]*klinika dam olish kuni`).test(asked.user),
    asked.user.split('\n').filter(l => l.includes(tomorrow)).join(' | ').slice(0, 200));
  ok("Claude'ga: shifokor jadvalidagi ichki izoh berilmaydi", !asked.user.includes('seminar') && new RegExp(`${tomorrow}[^\n]*: 08:00–16:30, 19:00–19:30`).test(asked.user));
  ok("Claude'ga: «qabulga yoz» amali va maydonlari", JSON.stringify(asked.format).includes('"book"') && JSON.stringify(asked.format).includes('book_doctor_id'));
  ok('oddiy savolga — oddiy javob taklifi (qabul yozilmaydi)', !!q && textOf(q).includes('Qaysi vaqt') && !textOf(q).includes('📅'));

  // «Men tasdiqlayman»: egasi bosgandagina CRM'ga yoziladi
  let posted = crm.posted.length;
  const newPatients = crm.patientsPosted.length;
  mark = sent.length;
  ask(C1, { doctor_id: 'd1', date: D3, time: '10:00', name: 'Vali Valiyev', phone: '+998 93 222 33 44' });
  const proposal = await waitFor('qabul kartasi', () => after(mark, OWNER, s => textOf(s).includes('📅')));
  ok('egasiga karta: kim, qaysi shifokorga, qachon', !!proposal && textOf(proposal).includes('Rustam Rustamov') && textOf(proposal).includes(D3) && textOf(proposal).includes('10:00') && textOf(proposal).includes('Vali Valiyev')
    && buttons(proposal)[0]?.text.includes('Yozish'), proposal ? textOf(proposal).replace(/\n/g, ' ').slice(0, 160) : '');
  await sleep(400);
  ok("tasdiqsiz: CRM'ga yozilmadi, bemorga «yozdik» deyilmadi", crm.posted.length === posted && !after(mark, C1, s => textOf(s).includes('yozdik')));
  const approve = buttons(proposal).find(b => b.callback_data?.startsWith('ra|'))!.callback_data!;
  // Bemor «ok» deb qo'ysa (javob shart bo'lmagan xabar) — egasidagi qabul kartasi bekor bo'lmaydi
  const okCalls = ai.replier.length;
  mark = sent.length;
  say(C1, 'ok');
  await sleep(1200);
  ok('bemor «ok» desa — qabul taklifi o\'z kuchida qoladi', !after(mark, OWNER, s => s.method === 'editMessageText') && ai.replier.length > okCalls);
  const replierCalls = ai.replier.length;
  mark = sent.length;
  press(OWNER, approve, proposal!.id!);
  press(OWNER, approve, proposal!.id!);
  const told = await waitFor('bemorga tasdiq', () => after(mark, C1, s => textOf(s).includes('yozdik')));
  const row = crm.posted.at(-1);
  await sleep(400);
  ok("«Yozish va yuborish»: CRM'ga yozildi va bemorga aytildi; bir zumda ikki bosish — bitta qabul, bitta xabar", !!told && crm.posted.length === posted + 1
    && sent.slice(mark).filter(s => Number(s.params.chat_id) === C1 && textOf(s).includes('yozdik')).length === 1 && ai.replier.length === replierCalls && row?.patientId === 'p2' && row.doctorId === 'd1' && row.date === D3 && row.time === '10:00');
  ok('telefoni bazada bor bemor qayta yaratilmadi', crm.patientsPosted.length === newPatients);
  mark = sent.length;
  press(OWNER, approve, proposal!.id!);
  await waitFor('ikkinchi bosish', () => sent.slice(mark).find(s => s.method === 'answerCallbackQuery'));
  ok('ikki marta bosilsa — ikkinchi qabul yozilmaydi', crm.posted.length === posted + 1);

  // «O'zi javob bersin»: bemor tanlagan vaqtga o'zi yozadi va egasiga aytadi
  await setMode('auto');
  await join(C2);
  posted = crm.posted.length;
  mark = sent.length;
  ask(C2, { doctor_id: 'd1', date: D3, time: '11:00', name: 'Lola Ergasheva', phone: '+998 90 700 80 90' });
  const auto = await waitFor('avto tasdiq', () => after(mark, C2, s => textOf(s).includes('yozdik')));
  const created = crm.patientsPosted.at(-1);
  ok("o'zi yozdi: yangi bemor yaratildi va qabul CRM'da", !!auto && crm.posted.length === posted + 1 && crm.patientsPosted.length === newPatients + 1 && created?.firstName === 'Lola' && created.lastName === 'Ergasheva'
    && crm.posted.at(-1)?.patientId === created.id && crm.posted.at(-1)?.time === '11:00');
  ok('egasiga: kimni qayerga yozgani aytildi', !!(await waitFor('xabar', () => after(mark, OWNER, s => textOf(s).includes('🤖') && textOf(s).includes('📅') && textOf(s).includes('Lola Ergasheva')))));

  // Band vaqt: «yozdik» deyilmaydi, bemor ham yaratilmaydi, qaror egasiga o'tadi
  await join(C3);
  posted = crm.posted.length;
  const patientsBefore = crm.patientsPosted.length;
  mark = sent.length;
  ask(C3, { doctor_id: 'd1', date: D3, time: '10:00', name: 'Sanjar Tursunov', phone: '+998 90 111 00 11' });
  const busy = await waitFor('band kartasi', () => after(mark, OWNER, s => textOf(s).includes('band')));
  await sleep(300);
  ok('band vaqt: yozilmadi, bemorga «yozdik» deyilmadi, egasiga sababi bilan', !!busy && crm.posted.length === posted && crm.patientsPosted.length === patientsBefore && !after(mark, C3, s => textOf(s).includes('yozdik')),
    busy ? textOf(busy).replace(/\n/g, ' ').slice(0, 160) : '');
  mark = sent.length;
  ask(C3, { doctor_id: 'd1', date: D3, time: '12:00', name: 'Sanjar Tursunov' });
  const noPhone = await waitFor('telefon kartasi', () => after(mark, OWNER, s => textOf(s).includes('telefon')));
  ok('telefonsiz yozilmaydi', !!noPhone && crm.posted.length === posted && !after(mark, C3, s => textOf(s).includes('yozdik')));
  mark = sent.length;
  ask(C3, { doctor_id: 'd9', date: D3, time: '12:00', name: 'Sanjar Tursunov', phone: '+998 90 111 00 11' });
  const noDoctor = await waitFor('shifokor kartasi', () => after(mark, OWNER, s => textOf(s).includes('shifokor topilmadi')));
  mark = sent.length;
  ask(C3, { doctor_id: 'd1', date: D3, time: '13:07', name: 'Sanjar Tursunov', phone: '+998 90 111 00 11' });
  const offGrid = await waitFor('vaqt kartasi', () => after(mark, OWNER, s => textOf(s).includes('13:07')));
  mark = sent.length;
  ask(C3, { doctor_id: 'd1', date: day(9), time: '12:00', name: 'Sanjar Tursunov', phone: '+998 90 111 00 11' });
  const tooFar = await waitFor('uzoq sana kartasi', () => after(mark, OWNER, s => textOf(s).includes('yaqin 7 kunga')));
  mark = sent.length;
  ask(C3, { doctor_id: 'd1', date: D3, time: '12:00', name: 'Sanjar', phone: '+998 90 111 00 11' });
  const oneName = await waitFor('ism kartasi', () => after(mark, OWNER, s => textOf(s).includes('familiyasi')));
  await sleep(300);
  ok("jadvalda yo'q shifokor, vaqt yoki kun, familiyasiz ism — yozilmaydi", !!noDoctor && !!offGrid && !!tooFar && !!oneName && crm.posted.length === posted && crm.patientsPosted.length === patientsBefore && !after(mark, C3, s => textOf(s).includes('yozdik')));

  // Telefon bazada boshqa odamniki: o'zi yozmaydi, egasidan so'raydi
  posted = crm.posted.length;
  mark = sent.length;
  ask(C3, { doctor_id: 'd1', date: D3, time: '12:30', name: 'Boshqa Odam', phone: '+998 90 111 22 33' });
  const stranger = await waitFor('boshqa ism kartasi', () => after(mark, OWNER, s => textOf(s).includes('Ali Valiyev')));
  await sleep(300);
  ok('telefon bazada boshqa ism bilan bo\'lsa — o\'zi yozmaydi, egasiga ko\'rsatadi', !!stranger && buttons(stranger).length === 2 && crm.posted.length === posted && !after(mark, C3, s => textOf(s).includes('yozdik')),
    stranger ? textOf(stranger).replace(/\n/g, ' ').slice(0, 200) : '');
  const strangers = crm.patientsPosted.length;
  mark = sent.length;
  press(OWNER, buttons(stranger).find(b => b.callback_data?.startsWith('ra|'))!.callback_data!, stranger!.id!);
  await waitFor('yangi bemor tasdig\'i', () => after(mark, C3, s => textOf(s).includes('yozdik')));
  const opened = crm.patientsPosted.at(-1);
  ok('egasi tasdiqlasa — begona kartaga emas, shu telefon bilan yangi bemor ochiladi', crm.patientsPosted.length === strangers + 1 && opened?.firstName === 'Boshqa' && opened.lastName === 'Odam'
    && opened.phone === '+998901112233' && crm.posted.at(-1)?.patientId === opened.id && crm.posted.at(-1)?.time === '12:30');
  mark = sent.length;
  say(C3, 'aldov qilib ko\'r');
  const fakeClaim = await waitFor('soxta tasdiq kartasi', () => after(mark, OWNER, s => textOf(s).includes('yozib qo')));
  await sleep(300);
  ok('qabul yozilmagan bo\'lsa «yozib qo\'ydik» degan javob bemorga o\'zi ketmaydi', !!fakeClaim && buttons(fakeClaim).length === 2 && !after(mark, C3, s => textOf(s).includes('yozib qo')));

  // Ikki bemor bir vaqtda bitta vaqtni tanlasa — faqat bittasi yoziladi
  const [C4, C5] = [7104, 7105];
  await join(C4);
  await join(C5);
  posted = crm.posted.length;
  mark = sent.length;
  ask(C4, { doctor_id: 'd2', date: D5, time: '15:00', name: 'Birinchi Bemor', phone: '+998 90 444 00 01' });
  ask(C5, { doctor_id: 'd2', date: D5, time: '15:00', name: 'Ikkinchi Bemor', phone: '+998 90 444 00 02' });
  await waitFor('poyga: tasdiq', () => sent.slice(mark).find(s => [C4, C5].includes(Number(s.params.chat_id)) && textOf(s).includes('yozdik')));
  await waitFor('poyga: band', () => after(mark, OWNER, s => textOf(s).includes('band')));
  await sleep(500);
  ok('bir vaqtga ikki bemor: bittasi yozildi, ikkinchisiga «yozdik» deyilmadi', crm.posted.length === posted + 1
    && sent.slice(mark).filter(s => [C4, C5].includes(Number(s.params.chat_id)) && textOf(s).includes('yozdik')).length === 1
    && crm.appointments.filter(a => a.doctorId === 'd2' && a.date === D5 && a.time === '15:00').length === 1);

  // Qabul CRM'ga yozilayotgan paytda bemor yana yozsa — xabar javobsiz yo'qolmaydi
  const C6 = 7106;
  await join(C6);
  mark = sent.length;
  crm.slowBooking = 200;
  crm.onBooking = () => { say(C6, 'yana bir savolim bor edi'); };
  ask(C6, { doctor_id: 'd2', date: D4, time: '16:00', name: 'Shoshgan Bemor', phone: '+998 90 444 00 06' });
  const late = await waitFor('kechikkan tasdiq', () => after(mark, C6, s => textOf(s).includes('yozdik')));
  const missed = await waitFor('yetkazilgan xabar', () => after(mark, OWNER, s => textOf(s).includes('yana bir savolim bor edi')));
  ok('qabul yozilayotganda kelgan xabar egasiga yetkaziladi', !!late && !!missed && textOf(missed).includes('yozilayotgan paytda'), missed ? textOf(missed).replace(/\n/g, ' ').slice(0, 160) : '');

  // Bitta suhbatdan bir kunda ko'p qabul yozib bo'lmaydi (zararli yoki adashgan suhbat CRM'ni to'ldirmasin)
  mark = sent.length;
  ask(C2, { doctor_id: 'd1', date: D4, time: '11:00', name: 'Lola Ergasheva', phone: '+998 90 700 80 90' });
  await waitFor('ikkinchi qabul', () => after(mark, C2, s => textOf(s).includes('yozdik')));
  posted = crm.posted.length;
  mark = sent.length;
  ask(C2, { doctor_id: 'd1', date: D5, time: '11:00', name: 'Lola Ergasheva', phone: '+998 90 700 80 90' });
  const tooMany = await waitFor('chegara kartasi', () => after(mark, OWNER, s => textOf(s).includes('chegara')));
  await sleep(300);
  ok("bir suhbatdan kuniga ko'pi bilan 2 ta qabul", !!tooMany && crm.posted.length === posted && !after(mark, C2, s => textOf(s).includes('yozdik')));
  await setMode('draft');
}

/** Yordamchi asboblari: kun hisoboti, bemor, bo'sh vaqt, yozish, token eskirishi */
export async function crmToolTests(h: Harness): Promise<void> {
  console.log('\n# DentaCRM: yordamchi asboblari');
  const { ok, api, token } = h;
  const { today, tomorrow } = days();
  /** Egasi yozadi → soxta Claude asbobni chaqiradi → natija (Claude'ga qaytgan JSON) */
  const tool = async (text: string) => {
    const before = ai.requests.length;
    const r = await api('/api/chat', { token, body: { text } });
    const reply = String(r.json.entries?.[1]?.text ?? '');
    // Faqat shu so'rovdan keyingi va shu biznesning suhbati (mijozlarga javob so'rovlari aralashmasin)
    const last = r.status === 200 ? ai.requests.slice(before).filter(q => q.system.includes('Name: Mebel Uyi')).at(-1)?.messages.at(-1)?.content : undefined;
    const block = Array.isArray(last) ? last.find(b => b.type === 'tool_result') : undefined;
    let result: Json = block?.content;
    try { result = JSON.parse(String(block?.content)); } catch { /* xato matni */ }
    return { reply, result, isError: !!block?.is_error };
  };

  const hits = (p: string) => crm.hits[p] ?? 0;
  // Mijozning o'zi: javoblardan faqat kerakli maydonlar olinadi, buzuq qatorlar ishni to'xtatmaydi
  const client = createDentaCrm({ baseUrl: `http://127.0.0.1:${h.crmPort}`, ...CRM_LOGIN });
  const kind = (p: Promise<unknown>) => p.then(() => 'ok', e => (e instanceof CrmError ? e.kind : 'boshqa'));
  const doc = (await client.doctors())[0] as unknown as Record<string, unknown>;
  ok("mijoz: shifokordan parol xeshi, klinikadan bot tokeni olinmaydi", Object.keys(doc).sort().join() === 'endHour,firstName,id,lastName,off,salaryType,specialty,startHour,status'
    && Object.keys(await client.clinic()).sort().join() === 'daysOff,endHour,id,name,startHour');
  const ph0 = hits('/api/patients');
  const everyone = await client.patients();
  await Promise.all([client.patients(), client.patients()]);
  ok("mijoz: bemorlar ro'yxati bir marta olinadi (keyingisi xotiradan)", hits('/api/patients') - ph0 === 1);
  ok("mijoz: raqam bo'lib kelgan telefon o'qiladi, id'siz qator tashlab ketiladi", everyone.find(p => p.id === 'px')?.phone === '998909998877' && !everyone.some(p => p.firstName === 'Buzuq') && everyone.length === 2007 + crm.patientsPosted.length, String(everyone.length));
  const evil = everyone.find(p => p.id === 'pz')!;
  ok("mijoz: CRM'dagi matn tozalanadi va qisqartiriladi (ko'rsatma bo'lib o'tmasin)", evil.firstName.length <= 80 && !/[<>\n`]/.test(evil.firstName), evil.firstName.slice(0, 40));
  crm.hugePatients = true;
  const big = createDentaCrm({ baseUrl: `http://127.0.0.1:${h.crmPort}`, ...CRM_LOGIN });
  ok('mijoz: haddan katta javob o\'qilmaydi', await kind(big.patients()) === 'protocol');
  crm.hugePatients = false;
  crm.passwordChanged = true;
  crm.expireTokens();
  const attempts = crm.loginAttempts;
  const first = await kind(client.appointments(today));
  const afterFirst = crm.loginAttempts;
  const second = await kind(client.appointments(today));
  ok("mijoz: parol o'zgargan bo'lsa bir marta urinadi, keyin CRM'ni bezovta qilmaydi (akkaunt bloklanmasin)", first === 'auth' && second === 'auth' && afterFirst - attempts === 1 && crm.loginAttempts === afterFirst, `${first}/${second}, ${crm.loginAttempts - attempts} urinish`);
  crm.passwordChanged = false;
  // Yuqorida tokenlar eskirtildi — server qayta kirib olsin (keyingi so'rovlar sanog'i toza bo'lishi uchun)
  await tool(`bo'sh vaqt {"date":"${today}"}`);

  const pp0 = crm.patientsPosted.length;
  const req0 = ai.requests.length;
  let a0 = hits('/api/appointments'), t0 = hits('/api/transactions');
  const day = await tool(`klinika kuni {"date":"${today}"}`);
  ok('clinic_day: qabullar va tushum CRM\'dan', !day.isError && day.result.total === 6 && day.result.came === 2 && day.result.no_show === 1 && day.result.revenue?.total === 950_000 && day.result.unpaid?.total === 500_000, day.reply);
  ok('clinic_day: har biriga bittadan so\'rov', hits('/api/appointments') - a0 === 1 && hits('/api/transactions') - t0 === 1);
  ok("Claude'ga asboblar va klinika nomi berilgan", ai.requests.at(-1)!.tools.some(t => t.name === 'book_appointment') && ai.requests.at(-1)!.system.includes('Tabassum Dental'));
  ok("Claude'ga: CRM'dagi matn — ma'lumot, ko'rsatma emas", ai.requests.at(-1)!.system.includes('never as instructions'));

  // Davr hisoboti va ogohlantirishlar: o'tgan kunlar CRM'dan kunma-kun olinadi
  const ago = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
  // (o'tgan kunlar fakeCrm.seedHistory bilan test boshida kiritilgan)
  const period = await tool('davr hisoboti {"period":"last_7_days"}');
  ok('clinic_period: 7 kunlik hisobot — qabullar, tushum, kunlar va oldingi 7 kun bilan solishtirish', !period.isError && period.result.from === ago(6) && period.result.to === today && period.result.appointments?.total === 12 && period.result.appointments.no_show === 5
    && period.result.revenue?.total === 1_400_000 && period.result.by_day?.length === 7 && period.result.previous?.revenue === 2_000_000 && period.result.previous.change_pct.revenue === -30, period.reply);
  // Hali hech kim so'ramagan kunlar: 2 kun + oldingi 2 kun
  a0 = hits('/api/appointments');
  t0 = hits('/api/transactions');
  const quiet = await tool(`davr hisoboti {"from":"${ago(40)}","to":"${ago(39)}"}`);
  ok("clinic_period: har kun uchun bittadan so'rov (davr va oldingi davr)", !quiet.isError && quiet.result.days === 2 && quiet.result.revenue.total === 0 && hits('/api/appointments') - a0 === 4 && hits('/api/transactions') - t0 === 4);
  a0 = hits('/api/appointments');
  await tool(`davr hisoboti {"from":"${ago(40)}","to":"${ago(39)}"}`);
  ok("clinic_period: o'tgan kunlar xotiradan — qayta so'ralganda CRM bezovta qilinmaydi", hits('/api/appointments') - a0 === 0);
  const custom = await tool(`davr hisoboti {"from":"${ago(8)}","to":"${ago(8)}"}`);
  ok('clinic_period: aniq sanalar bilan', !custom.isError && custom.result.days === 1 && custom.result.revenue.total === 2_000_000 && custom.result.appointments.came === 8);
  const ahead = await tool(`davr hisoboti {"from":"${ago(1)}","to":"${tomorrow}"}`);
  ok("clinic_period: kelajak kunlar hisobga kirmaydi (davr bugun bilan tugaydi), bugun hali tugamagani aytiladi", !ahead.isError && ahead.result.to === today && ahead.result.days === 2 && ahead.result.includes_today === true && custom.result.includes_today === false);
  const notYet = await tool(`davr hisoboti {"from":"${tomorrow}","to":"${tomorrow}"}`);
  ok('clinic_period: hali boshlanmagan davr — xato', notYet.isError && String(notYet.result).includes('boshlanmagan'), String(notYet.result));
  // CRM sanani e'tiborsiz qoldirib hamma to'lovni qaytarsa ham — faqat shu kunniki hisoblanadi
  crm.looseDates = true;
  const loose = await tool(`klinika kuni {"date":"${today}"}`);
  crm.looseDates = false;
  ok("to'lovlar: CRM sana bo'yicha saralamasa ham boshqa kunlar qo'shilib ketmaydi", !loose.isError && loose.result.revenue.total === 950_000, JSON.stringify(loose.result?.revenue));
  const wide = await tool(`davr hisoboti {"from":"${ago(60)}","to":"${today}"}`);
  ok('clinic_period: juda uzun davr rad etiladi', wide.isError && String(wide.result).includes('31'), String(wide.result));
  const watch = await tool('klinika nazorati {}');
  ok("clinic_alerts: kecha tushum odatdagidan keskin kam va ko'p bemor kelmagani aytiladi", !watch.isError && watch.result.alerts?.some((a: string) => a.includes('tushum') && a.includes('450 000')) && watch.result.alerts.some((a: string) => a.includes('4 ta bemor kelmadi')), JSON.stringify(watch.result));
  ok("Claude'ga: davr hisoboti va nazorat asboblari berilgan", ai.requests.at(-1)!.tools.some(t => t.name === 'clinic_period') && ai.requests.at(-1)!.tools.some(t => t.name === 'clinic_alerts'));

  // Pul yozuvlari: yordamchi faqat taklif tayyorlaydi; egasi tasdiqlagandagina CRM'ga yoziladi
  const moneyDo = (id: string, verb: string) => api(`/api/crm/money/${id}/${verb}`, { token, body: {} });
  const txCount = () => crm.transactions.length;
  let tx0 = txCount();
  const pay = await tool(`to'lov yoz {"patient_id":"p1","amount":350000,"method":"Card","service":"Plomba","doctor_id":"d1"}`);
  ok("record_payment: taklif tayyorlandi, CRM'ga hech narsa yozilmadi", !pay.isError && pay.result.status === 'waiting_for_owner' && !!pay.result.draft_id && txCount() === tx0
    && pay.result.summary?.join(' | ').includes('Ali Valiyev') && pay.result.summary.join(' | ').includes('350 000') && pay.result.summary.join(' | ').includes('Rustam Rustamov'), JSON.stringify(pay.result));
  const confirmed = await moneyDo(pay.result.draft_id, 'confirm');
  const paidRow = crm.transactions.at(-1);
  ok("tasdiqlangach: to'lov CRM'ga yozildi (to'g'ri bemor, shifokor, summa, usul, bugungi sana)", confirmed.status === 200 && confirmed.json.entry.status === 'done' && confirmed.json.entry.canUndo === true && txCount() === tx0 + 1
    && paidRow?.patientId === 'p1' && paidRow.patientName === 'Ali Valiyev' && paidRow.doctorId === 'd1' && paidRow.amount === 350_000 && paidRow.type === 'Card' && paidRow.service === 'Plomba' && paidRow.status === 'Paid' && paidRow.date === today, JSON.stringify(paidRow));
  const twice = await moneyDo(pay.result.draft_id, 'confirm');
  ok('ikki marta tasdiqlansa — ikkinchi marta yozilmaydi', twice.status === 409 && txCount() === tx0 + 1, String(twice.json.error));
  const dayAfter = await tool(`klinika kuni {"date":"${today}"}`);
  ok("to'lov kun tushumida ko'rinadi", dayAfter.result.revenue?.total === 950_000 + 350_000);
  const repeatPay = await tool(`to'lov yoz {"patient_id":"p1","amount":350000,"method":"Card","service":"Plomba","doctor_id":"d1"}`);
  const repeatDone = await moneyDo(repeatPay.result.draft_id, 'confirm');
  ok('aynan shunday to\'lov shu kuni bor — takror yozilmaydi', repeatDone.status === 409 && repeatDone.json.entry?.status === 'failed' && String(repeatDone.json.error).includes('allaqachon bor') && txCount() === tx0 + 1, String(repeatDone.json.error));
  const undone = await moneyDo(pay.result.draft_id, 'undo');
  ok("ortga qaytarish: yozuv CRM'dan o'chirildi", undone.status === 200 && undone.json.entry.status === 'undone' && undone.json.entry.canUndo === false && txCount() === tx0 && !crm.transactions.some(t => t.id === paidRow?.id));
  ok('ortga qaytarilgan yozuvni qayta tasdiqlab ham, qayta qaytarib ham bo\'lmaydi', (await moneyDo(pay.result.draft_id, 'confirm')).status === 409 && (await moneyDo(pay.result.draft_id, 'undo')).status === 409 && txCount() === tx0);

  const dropped = await tool(`to'lov yoz {"patient_id":"p2","amount":120000,"doctor_id":"d1"}`);
  const cancelled = await moneyDo(dropped.result.draft_id, 'cancel');
  ok("bekor qilingan taklif yozilmaydi", cancelled.status === 200 && cancelled.json.entry.status === 'cancelled' && (await moneyDo(dropped.result.draft_id, 'confirm')).status === 409 && txCount() === tx0);
  const noDoctor = await tool(`to'lov yoz {"patient_id":"p2","amount":120000}`);
  const badSum = await tool(`to'lov yoz {"patient_id":"p2","amount":0,"doctor_id":"d1"}`);
  const advance = await tool(`to'lov yoz {"patient_id":"p2","amount":50000,"doctor_id":"d1","service":"Avans"}`);
  const ghost = await tool(`to'lov yoz {"patient_id":"yoq","amount":50000,"doctor_id":"d1"}`);
  const future = await tool(`to'lov yoz {"patient_id":"p2","amount":50000,"doctor_id":"d1","date":"${tomorrow}"}`);
  ok("record_payment: shifokorsiz (klinikada ikkitasi bor), nol summa, avans, yo'q bemor, kelajak sana — taklif tayyorlanmaydi", noDoctor.isError && String(noDoctor.result).includes('shifokor') && badSum.isError && advance.isError && String(advance.result).includes('Avans')
    && ghost.isError && future.isError && txCount() === tx0, [noDoctor.result, advance.result, future.result].join(' | '));

  const ex0 = crm.expenses.length;
  const rent = await tool('xarajat yoz {"amount":2000000,"category":"Rent","title":"Ijara oktabr","method":"Transfer"}');
  const rentDone = await moneyDo(rent.result.draft_id, 'confirm');
  const rentRow = crm.expenses.at(-1);
  ok('record_expense: tasdiqlangach xarajat CRM\'ga yozildi', !rent.isError && crm.expenses.length === ex0 + 1 && rentDone.json.entry?.status === 'done' && rentRow?.category === 'Rent' && rentRow.amount === 2_000_000 && rentRow.title === 'Ijara oktabr'
    && rentRow.method === 'Transfer' && rentRow.date === today && !rentRow.doctorId, JSON.stringify(rentRow));
  const share = await tool('maosh ber {"doctor_id":"d1","amount":3000000}');
  const shareDone = await moneyDo(share.result.draft_id, 'confirm');
  ok("pay_doctor: foizli shifokorga — «shifokor ulushi» bo'lib, shifokori bilan yoziladi", !share.isError && shareDone.json.entry?.status === 'done' && crm.expenses.at(-1)?.category === 'DoctorShare' && crm.expenses.at(-1)?.doctorId === 'd1' && crm.expenses.at(-1)?.amount === 3_000_000
    && String(crm.expenses.at(-1)?.title).includes('Rustam Rustamov'));
  const salary = await tool('maosh ber {"doctor_id":"d2","amount":5000000}');
  ok("pay_doctor: belgilangan oylikli shifokorga — «oylik» turi", !salary.isError && salary.result.summary.join(' ').includes('oylik') && crm.expenses.length === ex0 + 2);
  await moneyDo(salary.result.draft_id, 'cancel');

  // Bir xil taklif ikki marta tayyorlansa — bitta yozuv: ikkala karta ham bir vaqtda bosilsa ham bir marta yoziladi
  const one1 = await tool('xarajat yoz {"amount":91000,"category":"Other","title":"Kanselyariya"}');
  const one2 = await tool('xarajat yoz {"amount":91000,"category":"Other","title":"Kanselyariya"}');
  const pair = await Promise.all([moneyDo(one1.result.draft_id, 'confirm'), moneyDo(one2.result.draft_id, 'confirm')]);
  ok("bir xil taklif ikki marta tayyorlansa va ikkalasi bir vaqtda tasdiqlansa — CRM'ga bitta yoziladi", one1.result.draft_id === one2.result.draft_id && pair.filter(r => r.status === 200).length === 1 && crm.expenses.filter(e => e.title === 'Kanselyariya').length === 1);
  // CRM yozdi, lekin javobi kutilgan ko'rinishda emas: «yozilmadi, qayta bosing» deyilmaydi
  const odd = await tool('xarajat yoz {"amount":64000,"category":"Other","title":"Choy"}');
  crm.oddMoneyReply = true;
  const oddDone = await moneyDo(odd.result.draft_id, 'confirm');
  ok("CRM yozib, tushunarsiz javob qaytarsa — «natijasi noma'lum» (qayta bosib ikkinchi marta yozib bo'lmaydi)", oddDone.status === 409 && oddDone.json.entry?.status === 'unknown' && (await moneyDo(odd.result.draft_id, 'confirm')).status === 409 && crm.expenses.filter(e => e.title === 'Choy').length === 1, String(oddDone.json.error));
  const quietDel = await tool('xarajat yoz {"amount":58000,"category":"Other","title":"Qogoz"}');
  await moneyDo(quietDel.result.draft_id, 'confirm');
  crm.emptyDelete = true;
  const quietUndo = await moneyDo(quietDel.result.draft_id, 'undo');
  ok("o'chirishga bo'sh javob kelsa ham — ortga qaytarilgan deb to'g'ri ko'rsatiladi", quietUndo.status === 200 && quietUndo.json.entry?.status === 'undone' && !crm.expenses.some(e => e.title === 'Qogoz'), String(quietUndo.json.error ?? ''));
  const huge = await tool('xarajat yoz {"amount":900000000,"category":"Other","title":"Juda katta"}');
  const ruAdvance = await tool(`to'lov yoz {"patient_id":"p2","amount":50000,"doctor_id":"d1","service":"Предоплата"}`);
  ok('avans boshqa tilda yozilsa ham taklif tayyorlanmaydi', ruAdvance.isError && String(ruAdvance.result).includes('Avans'));
  ok("juda katta summa (bitta yozuv chegarasidan yuqori) — taklif tayyorlanmaydi", huge.isError && String(huge.result).includes('chegara'), String(huge.result));

  // CRM javob bermasa: yozilgan-yozilmagani noma'lum — qayta urinilmaydi
  const hung = await tool('xarajat yoz {"amount":77000,"category":"Other","title":"Suv"}');
  crm.hangMoney = true;
  const lost = await moneyDo(hung.result.draft_id, 'confirm');
  ok("javob kelmasa: «natijasi noma'lum», qayta bosilganda ikkinchi marta yozilmaydi", lost.status === 409 && lost.json.entry?.status === 'unknown' && String(lost.json.error).includes("noma'lum") && (await moneyDo(hung.result.draft_id, 'confirm')).status === 409
    && crm.expenses.filter(e => e.title === 'Suv').length === 1, String(lost.json.error));

  // Telegram: karta va tugmalar
  const moneyCard = (from: number) => sent.slice(from).find(s => Number(s.params.chat_id) === OWNER && String(s.params.text ?? '').includes('💰'));
  const keysOf = (s: Sent | undefined) => ((s?.params.reply_markup as { inline_keyboard?: { callback_data?: string; text: string }[][] })?.inline_keyboard ?? []).flat();
  let from = sent.length;
  say(OWNER, 'xarajat yoz {"amount":150000,"category":"Utilities","title":"Elektr"}');
  const card = await waitFor('pul kartasi', () => moneyCard(from));
  await sleep(200);
  ok("Telegram: egasiga tafsilotli karta va «Tasdiqlash / Bekor qilish» tugmalari, hali yozilmagan", !!card && String(card.params.text).includes('150 000') && String(card.params.text).includes("so'ramagan bo'lsangiz") && String(card.params.text).includes('Elektr') && keysOf(card).length === 2
    && keysOf(card)[0].text.includes('Tasdiqlash') && !crm.expenses.some(e => e.title === 'Elektr'));
  from = sent.length;
  press(OWNER, keysOf(card)[0].callback_data!, card!.id!);
  const written = await waitFor('yozildi', () => sent.slice(from).find(s => s.method === 'editMessageText' && String(s.params.text ?? '').includes('yozildi')));
  ok("Telegram: «Tasdiqlash» bosilgach CRM'ga yozildi, kartada «Ortga qaytarish» qoldi", !!written && crm.expenses.filter(e => e.title === 'Elektr').length === 1 && keysOf(written).length === 1 && keysOf(written)[0].text.includes('Ortga'));
  from = sent.length;
  press(OWNER, keysOf(written)[0].callback_data!, card!.id!);
  const reverted = await waitFor('qaytarildi', () => sent.slice(from).find(s => s.method === 'editMessageText' && String(s.params.text ?? '').includes('Ortga qaytarildi')));
  ok("Telegram: «Ortga qaytarish» — yozuv CRM'dan o'chdi, tugma qolmadi", !!reverted && !crm.expenses.some(e => e.title === 'Elektr') && keysOf(reverted).length === 0);
  ok("Claude'ga: pul asboblari va «tugma bosilmaguncha yozilmaydi» qoidasi berilgan", ai.requests.at(-1)!.tools.some(t => t.name === 'record_payment') && ai.requests.at(-1)!.tools.some(t => t.name === 'pay_doctor') && ai.requests.at(-1)!.system.includes('never say the money is recorded'));
  crm.transactions.push({ id: 'tbad', patientName: 'X', date: today, amount: 'abc', type: 'Cash', service: 'Plomba', status: 'Paid', clinicId: 'c1' });
  const badMoney = await tool(`klinika kuni {"date":"${today}"}`);
  ok("summa o'qilmasa — xato aytiladi (0 deb hisoblanmaydi)", badMoney.isError, JSON.stringify(badMoney.result).slice(0, 80));
  crm.transactions.pop();
  crm.transactions.push({ id: 'tstr', patientName: 'X', date: today, amount: '100000', type: 'Cash', service: 'Plomba', status: 'Paid', clinicId: 'c1' });
  ok('summa satr bo\'lib kelsa ham to\'g\'ri qo\'shiladi', (await tool(`klinika kuni {"date":"${today}"}`)).result.revenue?.total === 1_050_000);
  crm.transactions.pop();
  const noDay = await tool('klinika kuni {"date":"2026-02-31"}');
  ok("taqvimda yo'q sana — asbob qabul qilmaydi", noDay.isError, String(noDay.result).slice(0, 60));

  const found = await tool('bemor top {"query":"valiyev"}');
  ok('find_patient: ikkita Valiyev, balans va oxirgi tashrif bilan', found.result.total === 2 && found.result.patients?.[0]?.patient_id === 'p1' && found.result.patients[0].balance === 150_000 && found.result.patients[0].last_visit === today);
  await tool('bemor top {"query":"+998 91 333 44 55"}');

  const free = await tool(`bo'sh vaqt {"date":"${tomorrow}","doctor_id":"d1"}`);
  const slots: string[] = free.result.doctors?.[0]?.slots ?? [];
  ok("free_slots: ertaga Rustamovda 16 ta bo'sh vaqt", slots.length === 16 && !slots.includes('10:00') && slots.includes('11:30'), slots.join(' '));

  const booked = await tool(`qabulga yoz {"patient_id":"p3","doctor_id":"d1","date":"${tomorrow}","time":"11:30","type":"Konsultatsiya"}`);
  const posted = crm.posted.at(-1);
  ok('book_appointment: CRM\'ga yozildi', !booked.isError && booked.result.booked?.time === '11:30' && posted?.patientId === 'p3' && posted.doctorId === 'd1' && posted.date === tomorrow && posted.time === '11:30');
  ok("yozuv CRM kutgan ko'rinishda", posted?.status === 'Pending' && posted.reminderSent === false && posted.clinicId === 'c1' && posted.patientName === 'Oʻktam Karimov' && posted.doctorName === 'Rustam Rustamov' && posted.duration === 30);
  let n = crm.posted.length;
  const busy = await tool(`qabulga yoz {"patient_id":"p4","doctor_id":"d1","date":"${tomorrow}","time":"10:30"}`);
  ok('band vaqtga yozmaydi (CRM\'ga so\'rov ham ketmaydi)', busy.isError && String(busy.result).includes('band') && crm.posted.length === n, String(busy.result));
  const d2Free = await tool(`bo'sh vaqt {"date":"${tomorrow}","doctor_id":"d2"}`);
  const d2Slots: string[] = d2Free.result.doctors?.[0]?.slots ?? [];
  ok("shifokor band bo'lgan soatlar (CRM jadvalidan) taklif qilinmaydi", d2Slots.includes('16:30') && !d2Slots.includes('17:00') && !d2Slots.includes('18:30') && d2Slots.includes('19:00'), d2Slots.join(' '));
  const offBook = await tool(`qabulga yoz {"patient_id":"p4","doctor_id":"d2","date":"${tomorrow}","time":"17:30"}`);
  ok('shifokor ishlamaydigan vaqtga yozmaydi, sababini aytadi', offBook.isError && String(offBook.result).includes('seminar') && crm.posted.length === n, String(offBook.result));
  const closedFree = await tool(`bo'sh vaqt {"date":"${crm.closedDay}"}`);
  ok('klinikaning dam olish kunida bo\'sh vaqt yo\'q, sababi bilan', closedFree.result.doctors?.every((d: Json) => d.slots.length === 0 && String(d.off).includes('klinika')), JSON.stringify(closedFree.result.doctors?.[0]));
  crm.raceBooking = true;
  const race = await tool(`qabulga yoz {"patient_id":"p5","doctor_id":"d1","date":"${tomorrow}","time":"13:00"}`);
  ok('CRM eski yozuvni qaytarsa — «yozildi» demaydi, mavjud vaqtni aytadi', race.isError && String(race.result).includes('15:00') && crm.posted.length === n
    && crm.appointments.filter(a => a.patientId === 'p5' && a.date === tomorrow).length === 1, String(race.result));

  const fresh = await tool(`qabulga yoz {"new_patient":{"first_name":"Kamola","last_name":"Yusupova","phone":"+998 95 777 88 99"},"doctor_id":"d2","date":"${tomorrow}","time":"12:00"}`);
  ok('yangi bemor: avval bemor, keyin qabul yaratiladi', !fresh.isError && crm.patientsPosted.length === pp0 + 1 && crm.patientsPosted.at(-1)!.clinicId === 'c1' && crm.posted.at(-1)?.patientId === crm.patientsPosted.at(-1)!.id);
  const p1 = hits('/api/patients');
  const again = await tool('bemor top {"query":"957778899"}');
  ok("yangi bemor qayta yuklamasdan topiladi", again.result.total === 1 && hits('/api/patients') - p1 === 0);
  const dup = await tool(`qabulga yoz {"new_patient":{"first_name":"Ali","last_name":"Valiyev","phone":"998901112233"},"doctor_id":"d2","date":"${tomorrow}","time":"13:00"}`);
  ok('telefoni bazada bor odam yangi bemor qilib qo\'shilmaydi', dup.isError && String(dup.result).includes('Ali Valiyev') && crm.patientsPosted.length === pp0 + 1, String(dup.result));
  n = crm.posted.length;
  const both = await tool(`qabulga yoz {"doctor_id":"d1","date":"${tomorrow}","time":"16:00"}`);
  ok('bemor ko\'rsatilmasa — xato, CRM\'ga hech narsa yozilmaydi', both.isError && String(both.result).includes('bittasi') && crm.posted.length === n, String(both.result));
  const shortPhone = await tool(`qabulga yoz {"new_patient":{"first_name":"A","last_name":"B","phone":"12345"},"doctor_id":"d2","date":"${tomorrow}","time":"13:00"}`);
  ok("yangi bemor: to'liq bo'lmagan telefon rad etiladi", shortPhone.isError && crm.patientsPosted.length === pp0 + 1);
  const third = await tool(`qabulga yoz {"patient_id":"p4","doctor_id":"d2","date":"${tomorrow}","time":"14:00"}`);
  const fourth = await tool(`qabulga yoz {"patient_id":"f7","doctor_id":"d2","date":"${tomorrow}","time":"16:30"}`);
  ok('kunlik chegara: undan ortiq qabul yozmaydi', !third.isError && fourth.isError && String(fourth.result).includes('chegara') && crm.posted.length === n + 1, String(fourth.result));

  // Token eskirdi: parallel so'rovlar bitta qayta kirish bilan tiklanadi
  for (const edition of ['cloud', 'local'] as const) {
    crm.edition = edition;
    crm.expireTokens();
    const logins = crm.logins;
    const r = await tool(`klinika kuni {"date":"${today}"}`);
    ok(`token eskirsa (${edition === 'cloud' ? '401' : '403'}) — o'zi qayta kiradi, bir marta`, !r.isError && r.result.total === 6 && crm.logins - logins === 1, `${crm.logins - logins} kirish`);
  }
  crm.edition = 'cloud';
  crm.refreshNext = true;
  await tool(`klinika kuni {"date":"${today}"}`);
  const refreshed = [...crm.tokens].at(-1)!;
  await tool(`klinika kuni {"date":"${today}"}`);
  ok('CRM yangi token bersa — keyingi so\'rov shu bilan ketadi', crm.lastAuth === refreshed);

  crm.unlicensed = true;
  let logins = crm.logins;
  const lic = await tool(`klinika kuni {"date":"${today}"}`);
  ok('litsenziya yo\'q — tushunarli xato, qayta kirishga urinmaydi', lic.isError && String(lic.result).toLowerCase().includes('litsenziya') && crm.logins === logins, String(lic.result));
  crm.unlicensed = false;
  crm.rejectAll = true;
  logins = crm.logins;
  const rej = await tool(`klinika kuni {"date":"${today}"}`);
  ok('CRM kirishni rad etsa — bir marta urinadi va tushuntiradi', rej.isError && crm.logins - logins === 1 && String(rej.result).includes('Ulanishlar'), String(rej.result));
  ok('panelda: muammo ko\'rinadi', !!(await api('/api/me', { token })).json.status.crm.problem);
  crm.rejectAll = false;
  await tool(`klinika kuni {"date":"${today}"}`);
  ok('tiklangach muammo yo\'qoladi', (await api('/api/me', { token })).json.status.crm.problem === null);

  const sentToAi = JSON.stringify(ai.requests.slice(req0));
  ok("Claude'ga va logga: parol xeshi, CRM paroli, token, ortiqcha maydon ketmaydi",
    ![CRM_HASH.slice(0, 12), CRM_LOGIN.password, 'jwt-fake-', 'SECRET-BOT-TOKEN', 'maxfiy'].some(s => sentToAi.includes(s) || h.serverLog().includes(s)));
  n = hits('/api/appointments');
  const other = await api('/api/chat', { token: h.otherToken, body: { text: `klinika kuni {"date":"${today}"}` } });
  ok('boshqa biznes bu klinikaning CRM\'idan foydalana olmaydi', String(other.json.entries?.[1]?.text).includes('ulanmagan') && hits('/api/appointments') === n
    && !ai.requests.at(-1)!.tools.some(t => t.name === 'clinic_day'), other.json.entries?.[1]?.text);

  const off = await api('/api/crm', { method: 'DELETE', token });
  ok('uzildi', off.json.status?.crm?.account === null);
  await api('/api/chat', { token, body: { text: 'Salom' } });
  ok('uzilgach: asboblar ro\'yxatida CRM yo\'q, suhbat yangidan', !ai.requests.at(-1)!.tools.some(t => t.name === 'clinic_day') && ai.requests.at(-1)!.messages.length === 1 && !ai.requests.at(-1)!.system.includes('Tabassum Dental'));
}
