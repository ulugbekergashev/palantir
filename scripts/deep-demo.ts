/**
 * Chuqur tahlil — haqiqiy model bilan sinov (pulli: taxminan 2–5 $, bir necha daqiqa). 6 oylik sun'iy stomatologiya klinikasi
 * ma'lumoti yasaladi, unga 8 ta yashirin qonuniyat joylanadi; server/insights/deep.ts ularni o'zi topishi kerak — qanchasini topgani
 * tahlilchining kuchini ko'rsatadi. Alohida bo'sh bazada (tmp/chuqur-demo), haqiqiy ma'lumotga tegmaydi.
 * Ishga tushirish: npx tsx scripts/deep-demo.ts
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

process.env.DATA_DIR = resolve('tmp/chuqur-demo');
rmSync(process.env.DATA_DIR, { recursive: true, force: true });
process.env.ASTERISK_WSL = '0';
const SANDBOX = process.env.DATA_DIR;
const { env } = await import('../server/env');
if (resolve(env.dataDir) !== resolve(SANDBOX)) throw new Error(`Sinov bazasi emas: ${env.dataDir}`);
const { businesses } = await import('../server/db');
const { crmTables, toCsv, local } = await import('../server/insights/tables');
const { runDeepAnalysis } = await import('../server/insights/deep');
const { hashPassword } = await import('../server/auth');
type Visit = import('../server/crm/dentacrm').VisitStat;
type Payment = import('../server/crm/dentacrm').PaymentStat;
type Patient = import('../server/crm/dentacrm').PatientStat;

// Takrorlanadigan tasodif (har ishga tushishda bir xil ma'lumot)
let seed = 20261020;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
const pad = (n: number) => String(n).padStart(2, '0');

const DAYS = 180, END = new Date('2026-10-19T12:00:00');
const dayOf = (i: number) => { const d = new Date(END.getTime() - (DAYS - 1 - i) * 86_400_000); return d; };
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DOCTORS = [
  { id: 'd1', name: 'Rustamov Aziz', types: ['Terapiya', 'Plomba', 'Kanal davolash'] },
  { id: 'd2', name: 'Karimova Nodira', types: ['Ortodontiya', 'Breket nazorati'] },      // [2] kutish uzoq, reyting past
  { id: 'd3', name: 'Yusupov Bekzod', types: ['Implant', 'Tish olish', 'Jarrohlik'] },
  { id: 'd4', name: 'Saidova Malika', types: ['Gigiyena', 'Bolalar terapiyasi'] },
];
const PRICE: Record<string, number> = { Terapiya: 350_000, Plomba: 450_000, 'Kanal davolash': 900_000, Ortodontiya: 1_200_000, 'Breket nazorati': 300_000, Implant: 4_500_000, 'Tish olish': 400_000, Jarrohlik: 1_500_000, Gigiyena: 300_000, 'Bolalar terapiyasi': 300_000 };

// Bemorlar
const patients: Patient[] = [];
for (let i = 0; i < 650; i++) {
  const female = chance(0.58), age = Math.floor(5 + rnd() * 70);
  const birth = new Date(END.getTime() - age * 365.25 * 86_400_000);
  patients.push({ id: `p${i}`, gender: female ? 'female' : 'male', dob: isoDay(birth), createdAt: dayOf(Math.floor(rnd() * DAYS)).toISOString(), label: chance(0.05) ? 'vip' : null, status: 'Active' });
}
const ageOf = (p: Patient) => (END.getFullYear() - Number(p.dob!.slice(0, 4)));

const visits: Visit[] = [], payments: Payment[] = [];
const leads: unknown[][] = [], convs: unknown[][] = [], calls: unknown[][] = [], cam: unknown[][] = [];
let vid = 0, tid = 0;
const firstVisit = new Map<string, string>();
const firstType = new Map<string, string>();
for (const p of patients) {
  // Yangi bemor qaysi kanaldan: instagram / telegram / qo'ng'iroq / tavsiya
  const channel = pick(['instagram', 'instagram', 'telegram', 'call', 'referral']);
  const startDay = Math.floor(rnd() * (DAYS - 10));
  const old = ageOf(p) >= 50, kid = ageOf(p) < 14, female = p.gender === 'female';
  // [5] Gigiyenadan boshlaganlar ko'proq qaytadi
  const firstT = kid ? 'Bolalar terapiyasi' : pick(['Gigiyena', 'Terapiya', 'Plomba', 'Ortodontiya', 'Implant', 'Tish olish', 'Gigiyena']);
  const returns = firstT === 'Gigiyena' ? (chance(0.6) ? 1 + Math.floor(rnd() * 3) : 0) : (chance(0.22) ? 1 : 0);
  // [4] 50+ — ko'proq va qimmatroq ish
  const extra = old ? Math.floor(rnd() * 3) : 0;
  const n = 1 + returns + extra;
  let day = startDay;
  for (let k = 0; k < n && day < DAYS; k++) {
    const d = dayOf(day), date = isoDay(d), wd = (d.getDay() + 6) % 7;
    if (wd === 6) { day++; k--; continue; }   // yakshanba dam
    const type = k === 0 ? firstT : old && chance(0.5) ? pick(['Implant', 'Jarrohlik', 'Kanal davolash']) : pick(['Terapiya', 'Plomba', 'Gigiyena', 'Breket nazorati']);
    const doc = DOCTORS.find(x => x.types.includes(type))!;
    // [3] Ayollar 25–45 ertalab (10–13), erkaklar kechqurun (17–19)
    const hour = female && ageOf(p) >= 25 && ageOf(p) <= 45 ? 10 + Math.floor(rnd() * 3) : !female && ageOf(p) >= 20 ? 17 + Math.floor(rnd() * 2) : 9 + Math.floor(rnd() * 9);
    const time = `${pad(hour)}:${chance(0.5) ? '00' : '30'}`;
    // [1] Instagram'dan kelgan yangi bemor birinchi qabulga ko'p kelmaydi; dushanba ertalab ham
    const noShowP = (k === 0 && channel === 'instagram' ? 0.27 : 0.07) + (wd === 0 && hour < 12 ? 0.08 : 0);
    const cancelled = chance(0.05);
    const noShow = !cancelled && chance(noShowP);
    const came = !cancelled && !noShow;
    const id = `v${++vid}`;
    // [2] Karimova: kutish ~22 daqiqa, reyting past; boshqalar ~5
    const wait = came ? Math.max(-5, Math.round((doc.id === 'd2' ? 22 : 5) + (rnd() - 0.5) * 12)) : null;
    const planned = type === 'Implant' || type === 'Jarrohlik' ? 60 : 30;
    const chair = came ? Math.round(planned * (0.8 + rnd() * 0.5)) : null;
    const sched = new Date(`${date}T${time}:00`);
    const entered = came ? new Date(sched.getTime() + wait! * 60_000) : null;
    const finished = came ? new Date(entered!.getTime() + chair! * 60_000) : null;
    const rating = came && chance(0.4) ? (doc.id === 'd2' ? pick([3, 3, 4, 4, 5]) : pick([4, 5, 5, 5, 5])) : null;
    visits.push({ id, patientId: p.id, doctorId: doc.id, doctorName: doc.name, type, date, time, duration: planned, status: cancelled ? 'Cancelled' : noShow ? 'No-Show' : 'Completed', callStatus: chance(0.6) ? pick(['confirmed', 'confirmed', 'no_answer', 'rescheduled']) : null, enteredAt: entered?.toISOString() ?? null, finishedAt: finished?.toISOString() ?? null, rating });
    if (!firstVisit.has(p.id) && came) { firstVisit.set(p.id, date); firstType.set(p.id, type); }
    if (came) {
      // [6] Shanba kunlari to'lovlarning bir qismi yozilmaydi (kassa)
      const lost = wd === 5 && chance(0.35);
      if (!lost) payments.push({ id: `t${++tid}`, patientId: p.id, appointmentId: id, amount: Math.round(PRICE[type] * (old ? 1.3 : 1) * (0.9 + rnd() * 0.2) / 1000) * 1000, discountAmount: 0, type: pick(['cash', 'card', 'card', 'transfer']), service: type, category: 'Umumiy', status: 'Paid', doctorId: doc.id, doctorName: doc.name, date, createdAt: finished!.toISOString() });
      // [7] Kamera: kreslo seansi; shanba kunlari CRM'da yo'q qo'shimcha seanslar ham bor
      cam.push(['Kabinet 1', `Kreslo ${doc.name.split(' ')[0]}`, 'chair', date, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][wd], local(entered!.toISOString())!.time, entered!.getHours(), local(finished!.toISOString())!.time, chair]);
      if (wd === 5 && chance(0.3)) cam.push(['Kabinet 1', `Kreslo ${doc.name.split(' ')[0]}`, 'chair', date, 'Sat', `${pad(hour + 1)}:10`, hour + 1, `${pad(hour + 1)}:45`, 35]);
      cam.push(['Qabulxona', 'Kutish zali', 'waiting', date, ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][wd], local(new Date(sched.getTime() - 10 * 60_000).toISOString())!.time, hour, local(entered!.toISOString())!.time, Math.max(1, wait! + 10)]);
    }
    day += 7 + Math.floor(rnd() * 60);
  }
  // Murojaat (mijoz) va yozishma: [8] dam olish kunlari javob sekin → bemorga aylanish kam
  const lead = `L${p.id}`;
  const contact = dayOf(Math.max(0, startDay - 2)), cwd = (contact.getDay() + 6) % 7, weekend = cwd >= 5;
  const replyMin = weekend ? Math.round(60 + rnd() * 120) : Math.round(2 + rnd() * 10);
  const contactIso = new Date(`${isoDay(contact)}T${pad(9 + Math.floor(rnd() * 12))}:15:00`).toISOString();
  const became = firstVisit.has(p.id) && (!weekend || chance(0.45));
  if (channel === 'instagram' || channel === 'telegram') {
    const a = local(contactIso)!;
    convs.push([lead, channel, a.date, a.weekday, a.time, a.hour, 1 + Math.floor(rnd() * 4), 1 + Math.floor(rnd() * 3), replyMin, weekend ? 'owner' : 'cerebro']);
  }
  if (channel !== 'referral') leads.push([lead, channel, became ? 'won' : 'lost', channel, local(contactIso)!.date, local(contactIso)!.weekday, local(contactIso)!.hour, became ? `P${p.id}` : null]);
}
// Qo'ng'iroqlar: kechki soatlarda (19–21) ko'p o'tkazib yuborilgan
for (let i = 0; i < DAYS; i++) {
  const d = dayOf(i);
  for (let k = 0; k < 6 + Math.floor(rnd() * 6); k++) {
    const hour = pick([9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21]);
    const missed = hour >= 19 ? chance(0.55) : chance(0.08);
    calls.push([isoDay(d), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][(d.getDay() + 6) % 7], `${pad(hour)}:${pad(Math.floor(rnd() * 60))}`, hour, 'in', missed ? 'missed' : 'ended', missed ? 0 : 60 + Math.floor(rnd() * 200), 'microsip', !missed && chance(0.35), null]);
  }
}

const biz = businesses.create('chuqur-demo', hashPassword('demo-parol-1'), { name: 'Tabassum Dental', ownerName: 'Dilshod', industry: 'stomatologiya', phone: '+998 71 200 00 00', address: 'Toshkent', contentLang: 'uz', brand: { primary: '#0F766E', accent: '#F59E0B' }, offerings: [], team: [] });
const code = (k: string, id: string) => `${k}${id}`;
const from = isoDay(dayOf(0)), to = isoDay(dayOf(DAYS - 1));
const files = [
  ...crmTables({ visits, payments, patients }, code, from, to),
  { name: 'camera_sessions.csv', rows: cam.length, about: 'Camera: each period a person stayed in a zone — chair (dental chair) or waiting (waiting area), start, end, minutes.', csv: toCsv(['camera', 'zone', 'zone_kind', 'date', 'weekday', 'start', 'hour', 'end', 'minutes'], cam as never) },
  { name: 'calls.csv', rows: calls.length, about: 'Incoming phone calls: date, time, status (ended / missed — nobody answered), duration, booked.', csv: toCsv(['date', 'weekday', 'time', 'hour', 'direction', 'status', 'duration_sec', 'source', 'booked', 'lead'], calls as never) },
  { name: 'conversations.csv', rows: convs.length, about: 'Customer messages per customer per day: first message time, messages in/out, minutes to the first reply, who replied.', csv: toCsv(['lead', 'channel', 'date', 'weekday', 'time', 'hour', 'messages_in', 'messages_out', 'first_reply_min', 'replied_by'], convs as never) },
  { name: 'leads.csv', rows: leads.length, about: 'Customers (inquiries): channel, stage (won = became a patient), date, and the patient code if they became a patient — join with visits.csv on patient.', csv: toCsv(['lead', 'channel', 'stage', 'source', 'date', 'weekday', 'hour', 'patient'], leads as never) },
];
mkdirSync('tmp/chuqur-demo/csv', { recursive: true });
for (const f of files) writeFileSync(`tmp/chuqur-demo/csv/${f.name}`, f.csv);
console.log("ma'lumot:", files.map(f => `${f.name} ${f.rows}`).join(' · '));

const t0 = Date.now();
const x = await runDeepAnalysis(biz, { days: DAYS, prepared: { files, from, to, notes: [] }, force: true });
console.log(`\ntahlil: ${Math.round((Date.now() - t0) / 1000)} s · $${x.cost} · ${x.findings.length} topilma · ${x.charts.length} grafik\n`);
console.log(`XULOSA: ${x.headline}\n`);
for (const f of x.findings) console.log(`[${f.impact}] ${f.title} — ${f.metric}\n   ${f.detail}\n   → ${f.action}${f.chart ? `  (grafik: ${f.chart})` : ''}\n`);
if (x.quality.length) console.log(`MA'LUMOT SIFATI:\n${x.quality.map(q => `  - ${q}`).join('\n')}`);
writeFileSync('tmp/chuqur-natija.json', JSON.stringify(x, null, 2));
