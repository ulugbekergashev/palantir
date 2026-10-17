/**
 * Stend uchun «taqlid miya», egasi tomoni: haqiqiy Claude o'rnida turadigan qoidalar to'plami (npm run stend, AI kaliti bo'lmaganda).
 * Maqsad — tizimning qolgan hamma qismini qo'lda sinash: egasi oddiy gap yozadi, shu qoidalar undan asbob chaqiruvini yasaydi,
 * asbobni esa haqiqiy server bajaradi (vazifa, eslatma, CRM, karta, bilim). Mijozlarga javob — scripts/stendCustomer.ts da.
 * Bu modelning aqli EMAS: gapni tushunish sifati, javob matni va noaniq vaziyatdagi qaror faqat haqiqiy model bilan baholanadi.
 * Tushunmagan gapini taxmin qilmaydi — ochiq aytadi; CRM'ga darhol yoziladigan ish (qabul) faqat hamma narsa aniq aytilganda bajariladi.
 */
import { parsePrices } from '../src/lib/prices';
import { DAYS, addDays, dayLong, dueLabel, fromIso, iso, weekday } from '../src/lib/week';
import { capital, clean, dueAt, fold, low, overlap, parseAmount, parseName, parsePhone, parseWhen, ranges, stems, sum, type When } from './stendParse';

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any
type Block = Record<string, Json>;
export type Msg = { role: 'user' | 'assistant'; content: string | Block[] };
export interface Turn { content: Block[]; stop: 'end_turn' | 'tool_use' }

/** Taqlid miya yozgan har bir javob shu belgi bilan boshlanadi — haqiqiy model javobi bilan adashtirilmasin */
export const MARK = '🧪 ';
const NO_CRM = "Bu ish uchun DentaCRM ulangan bo'lishi kerak (panel → Ulanishlar).";
const MAX_STEPS = 6;

interface Call { name: string; input: Json; ok: boolean; text: string; json: Json }
interface Ctx { raw: string; t: string; now: Date; today: string; when: When; calls: Call[]; has: (tool: string) => boolean; system: string }
type Intent = (ctx: Ctx) => Turn | null;

let seq = 0;
const say = (text: string): Turn => ({ content: [{ type: 'text', text: MARK + text }], stop: 'end_turn' });
const call = (name: string, input: Json): Turn => ({ content: [{ type: 'tool_use', id: `toolu_stend_${++seq}`, name, input }], stop: 'tool_use' });
const got = (ctx: Ctx, name: string): Call | undefined => ctx.calls.findLast(c => c.name === name);
const bullets = (list: string[]): string => list.map(l => `- ${l}`).join('\n');
const dayText = (date: string, now: Date): string =>
  (date === iso(now) ? 'bugun' : date === iso(addDays(now, 1)) ? 'ertaga' : date === iso(addDays(now, -1)) ? 'kecha' : `${dayLong('uz', fromIso(date))} (${DAYS.uz[weekday(fromIso(date))].toLowerCase()})`);

// ─── Egasining gapi → asbob ──────────────────────────────────────────────────

const STAMP = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})[^\]]*\](?: \(voice message, transcribed\))?\n/;

/** Shu navbatdagi egasining gapi va undan keyin chaqirilgan asboblar natijalari bilan */
function readTurn(messages: Msg[]): { text: string; calls: Call[] } {
  const textOf = (m: Msg): string | null => (typeof m.content === 'string' ? m.content : m.content.filter(b => b.type === 'text').at(-1)?.text ?? null);
  const start = messages.findLastIndex(m => m.role === 'user' && textOf(m) !== null);
  const used = new Map<string, { name: string; input: Json }>();
  const calls: Call[] = [];
  for (const m of messages.slice(start + 1)) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (m.role === 'assistant' && b.type === 'tool_use') used.set(b.id, { name: b.name, input: b.input });
      const made = m.role === 'user' && b.type === 'tool_result' ? used.get(b.tool_use_id) : undefined;
      if (!made) continue;
      const text = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
      let json: Json = null;
      if (!b.is_error) { try { json = JSON.parse(text); } catch { /* oddiy matn */ } }
      calls.push({ ...made, ok: !b.is_error, text, json });
    }
  }
  return { text: start >= 0 ? textOf(messages[start])! : '', calls };
}

interface Doctor { doctor_id: string; doctor: string; specialty?: string; slots: string[]; off: string | null }
interface Patient { patient_id: string; name: string; phone: string; last_visit: string | null; balance: number }

/** Gapda tilga olingan shifokor: avval familiyasi, keyin ismi bo'yicha; bittagina shifokor bo'lsa — o'sha */
function pickDoctor(doctors: Doctor[], t: string, except = ''): Doctor | null {
  const text = except ? t.replace(except.toLowerCase(), ' ') : t;
  const by = (part: number) => doctors.filter(d => { const w = low(d.doctor).split(' ').at(part); return !!w && w.length > 2 && text.includes(w); });
  const family = by(-1);
  if (family.length === 1) return family[0];
  const first = by(0);
  return first.length === 1 ? first[0] : doctors.length === 1 ? doctors[0] : null;
}
const doctorList = (doctors: Doctor[]): string => doctors.map(d => d.doctor).join(', ');

const lastDigits = (phone: string): string => phone.replace(/\D/g, '').slice(-9);
/**
 * Qidiruv natijasidan aynan shu bemor. CRM qidiruvi so'zning bir bo'lagi bo'yicha ham topadi («Sardor Ali» → «Sardor Aliyev») —
 * shuning uchun faqat so'zlari to'liq mos kelgani olinadi; telefon aytilgan bo'lsa, u ham mos kelishi shart
 */
function pickPatient(found: Call, name: string, phone = ''): { one: Patient | null; many: Patient[] } {
  const wanted = fold(name).split(' ').filter(Boolean);
  const named = ((found.json?.patients ?? []) as Patient[]).filter(p => { const has = fold(p.name).split(' '); return wanted.every(w => has.includes(w)); });
  const many = phone ? named.filter(p => lastDigits(p.phone) === lastDigits(phone)) : named;
  return { one: many.length === 1 ? many[0] : null, many };
}
const patientLine = (p: Patient): string => `${p.name}${p.phone ? ` (${p.phone})` : ''}`;
const notOne = (who: string, many: Patient[]): Turn =>
  say(many.length
    ? `«${who}» bo'yicha ${many.length} ta bemor topildi: ${many.slice(0, 5).map(patientLine).join('; ')}. Ism-familiyasini to'liq yozing.`
    : `«${who}» DentaCRM bazasida topilmadi. Ism-familiyasini tekshiring.`);

const METHODS: [RegExp, string][] = [[/click/, 'Click'], [/karta|plastik|terminal/, 'Card'], [/o'tkazma|perevod|hisob raqam/, 'Transfer'], [/naqd/, 'Cash']];
const methodOf = (t: string): Record<string, string> => { const hit = METHODS.find(([re]) => re.test(t)); return hit ? { method: hit[1] } : {}; };
const cardReady = (done: Call): Turn =>
  say(`Kartani tayyorladim:\n${bullets(done.json.summary)}\n\nTekshirib, «Tasdiqlash»ni bosing — DentaCRM'ga shundan keyingina yoziladi.${done.json.warning ? `\n⚠️ ${done.json.warning}` : ''}`);

const payDoctor: Intent = ctx => {
  if (!/(ulush|maosh|oylik|ish haqi)/.test(ctx.t) || !/(ber(dim|dik|ildi)|to'la(dim|dik|ndi)|o'tkaz(dim|dik))/.test(ctx.t)) return null;
  const money = parseAmount(ctx.when.rest);
  if (!money) return say("Summani yozing. Masalan: «Rustamovga 3 million ulush berdim».");
  if (!ctx.has('pay_doctor')) return say(NO_CRM);
  const done = got(ctx, 'pay_doctor');
  if (done) return cardReady(done);
  const board = got(ctx, 'free_slots');
  if (!board) return call('free_slots', { date: ctx.today });
  const doctor = pickDoctor(board.json.doctors, ctx.t);
  if (!doctor) return say(`Qaysi shifokorga? Familiyasini yozing. Shifokorlar: ${doctorList(board.json.doctors)}.`);
  return call('pay_doctor', { doctor_id: doctor.doctor_id, amount: money.amount, ...methodOf(ctx.t) });
};

const payment: Intent = ctx => {
  if (!/to'la(di|b ketdi|shdi|gan)(?![\p{L}])|to'lov qil(di|gan)|pul berdi/u.test(ctx.t)) return null;
  const money = parseAmount(ctx.when.rest);
  if (!money) return say("To'lov summasini yozing. Masalan: «Ali Valiyev 350 ming to'ladi, karta, Rustamov».");
  if (!ctx.has('record_payment')) return say(NO_CRM);
  const done = got(ctx, 'record_payment');
  if (done) return cardReady(done);
  const who = parseName(money.rest) ?? money.rest.split(/to'la|to'lov|pul berdi/i)[0].replace(/\b(bemor|mijoz)\b/gi, ' ').replace(/[,.:;]+/g, ' ').trim().split(/\s+/).slice(0, 2).join(' ');
  if (who.length < 3) return say("Kim to'laganini yozing. Masalan: «Ali Valiyev 350 ming to'ladi».");
  const found = got(ctx, 'find_patient');
  if (!found) return call('find_patient', { query: who });
  const patient = pickPatient(found, who);
  if (!patient.one) return notOne(who, patient.many);
  const board = got(ctx, 'free_slots');
  if (!board) return call('free_slots', { date: ctx.today });
  const doctor = pickDoctor(board.json.doctors, ctx.t, who);
  if (!doctor) return say(`Bu to'lov qaysi shifokorga tegishli? Gapni shifokor familiyasi bilan qayta yozing. Shifokorlar: ${doctorList(board.json.doctors)}.`);
  const service = /([\p{L}']+)\s+uchun/u.exec(money.rest)?.[1];
  return call('record_payment', {
    patient_id: patient.one.patient_id, amount: money.amount, doctor_id: doctor.doctor_id, ...methodOf(ctx.t),
    ...(service ? { service: capital(service) } : {}), ...(ctx.when.date && ctx.when.date !== ctx.today ? { date: ctx.when.date } : {}),
  });
};

const CATEGORIES: [RegExp, string, string][] = [
  [/ijara|arenda/, 'Rent', 'Ijara'], [/svet|elektr|gaz|suv|kommunal|internet/, 'Utilities', 'Kommunal'],
  [/laborator|zubotexnik|texnikka/, 'Lab', 'Laboratoriya'], [/material|qo'lqop|niqob|dori|anestez|sotib ol|xarid/, 'Inventory', 'Materiallar'],
];
const expense: Intent = ctx => {
  if (!/xarajat|chiqim|ketdi|sarfla(dim|dik|ndi)|sotib oldi[mk]|to'ladi[mk]|berdi[mk]/.test(ctx.t)) return null;
  const money = parseAmount(ctx.when.rest);
  if (!money) return null;
  if (!ctx.has('record_expense')) return say(NO_CRM);
  const done = got(ctx, 'record_expense');
  if (done) return cardReady(done);
  const [, category, label] = CATEGORIES.find(([re]) => re.test(ctx.t)) ?? [null, 'Other', 'Boshqa xarajat'];
  const title = money.rest
    .replace(/\b(xarajat(ga)?|chiqim|ketdi|sarfladim|sarfladik|sarflandi|sotib oldim|sotib oldik|to'ladim|to'ladik|berdim|berdik|yoz(ib qo'y)?|uchun|naqd|karta(dan)?|click)\b/gi, ' ')
    .replace(/[,.:;!]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/(?<=\p{L}{3})ga$/iu, '');
  return call('record_expense', { amount: money.amount, category, title: capital(title) || label, ...methodOf(ctx.t), ...(ctx.when.date && ctx.when.date !== ctx.today ? { date: ctx.when.date } : {}) });
};

/**
 * Qabulga yozish CRM'ga darhol yoziladi (tasdiq kartasisiz) — shuning uchun faqat aniq buyruq: gap «…yoz» bilan tugaydi,
 * bemor, kun va aniq soat aytilgan. «Ali Valiyev bugun 15:00 da qabulga kelmadi» — xabar, buyruq emas.
 */
const booking: Intent = ctx => {
  const phone = parsePhone(ctx.when.rest);
  // Buyruq so'zi gap oxirida (yangi bemorning telefoni undan keyin kelishi mumkin: «…Rustamovga yoz, telefoni +998…»)
  const command = low(phone?.rest ?? ctx.when.rest).replace(/[\s,.:;!]+$/, '').replace(/[\s,]+(telefoni?|tel|raqami?)$/, '');
  if (!/(?:^|[\s,])(yoz(ib\s+qo'y)?|yozdir)(ing|gin)?$/.test(command) || /(narx|sahifa|vazifa|xarajat|eslat|to'la|mijoz|kelma|bekor|ko'chir)/.test(ctx.t)) return null;
  const who = parseName(phone?.rest ?? ctx.when.rest);
  if (!ctx.when.date && !ctx.when.time && !ctx.when.part) return null;
  if (!ctx.has('book_appointment')) return say(NO_CRM);
  const done = got(ctx, 'book_appointment');
  if (done) { const b = done.json.booked; return say(`Qabulga yozdim: ${b.patient} — ${b.doctor}, ${dayText(b.date, ctx.now)} soat ${b.time}. DentaCRM'da ko'rinadi.`); }
  if (!who) return say("Kimni yozay? Bemorning ism-familiyasini katta harf bilan yozing. Masalan: «Ali Valiyevni ertaga 15:00 ga Rustamovga yoz».");
  // «Ertalab» — aniq vaqt emas: o'zicha 09:00 deb yozib qo'ymaydi
  if (!ctx.when.time) return say(`Aniq soatini ham yozing. Masalan: «${who}ni ertaga 15:00 ga Rustamovga yoz».`);
  const date = ctx.when.date ?? ctx.today;
  const found = got(ctx, 'find_patient');
  if (!found) return call('find_patient', { query: who });
  const board = got(ctx, 'free_slots');
  if (!board) return call('free_slots', { date });
  const doctor = pickDoctor(board.json.doctors, ctx.t, who);
  if (!doctor) return say(`Qaysi shifokorga yozay? Familiyasini qo'shib qayta yozing. Shifokorlar: ${doctorList(board.json.doctors)}.`);
  const patient = pickPatient(found, who, phone?.phone);
  const slot = { doctor_id: doctor.doctor_id, date, time: ctx.when.time };
  if (patient.one) return call('book_appointment', { patient_id: patient.one.patient_id, ...slot });
  if (patient.many.length) return notOne(who, patient.many);
  if (!phone) return say(`«${who}» bazada yo'q. Yangi bemor ochishim uchun telefon raqamini ham qo'shib yozing.`);
  const [first, ...family] = who.split(' ');
  return call('book_appointment', { new_patient: { first_name: first, last_name: family.join(' '), phone: phone.phone }, ...slot });
};

const REMEMBER = /(shuni\s+)?(eslab qol|yodda tut|yodda saqla|yodingda tut|esda tut|bilib qo'y)(ing|gin)?/i;
const remember: Intent = ctx => {
  if (!REMEMBER.test(ctx.raw)) return null;
  const done = got(ctx, 'remember');
  if (done) return say(`Eslab qoldim: «${done.json.saved.text}». Mijozlar so'rasa, shundan javob beraman.`);
  const fact = capital(ctx.raw.replace(REMEMBER, ' ').replace(/^[\s:,.—–-]+|[\s:,—–-]+$/g, '').replace(/\s+/g, ' '));
  return fact.length < 4 ? say("Nimani eslab qolay? Masalan: «Eslab qol: yakshanba kuni ishlamaymiz».") : call('remember', { fact: fact.slice(0, 500) });
};

const prices: Intent = ctx => {
  if (!/narx/.test(ctx.t) || !/(saqla|yoz|qo'sh|o'zgar|yangila|kirit|bo'ldi|qo'y)/.test(ctx.t)) return null;
  const done = got(ctx, 'save_prices');
  if (done) return say(`Narxlar jadvalini yangiladim: ${done.json.added} ta yangi xizmat, ${done.json.updated} tasining narxi o'zgardi (jami ${done.json.total} ta). Mijozlarga endi shu narxlar aytiladi.`);
  const head = /^[^\d:]*:/.exec(ctx.raw)?.[0];
  const body = head && /narx/i.test(head)
    ? ctx.raw.slice(head.length)
    : ctx.raw.replace(/narx(lar)?(ini|ni|i|larni|lari)?/gi, ' ').replace(/\b(saqla(b qo'y)?|yoz(ib qo'y)?|qo'sh(ib qo'y)?|yangila|kirit|o'zgartir|o'zgardi|bo'ldi|endi|jadvalga)(ing|gin)?\b/gi, ' ');
  const items = parsePrices(body.split(/\n|;|,\s+(?=\p{L})/u).map(l => l.trim()).filter(Boolean).join('\n')).items.filter(i => i.price > 0);
  return items.length ? call('save_prices', { items: items.slice(0, 100) }) : say("Narxni tushunmadim. Masalan: «Narxlarni saqla: Plomba 400 ming, Vinir 1,9 mln».");
};

const ABOUT: [RegExp, string][] = [[/manzil/, 'Manzil'], [/ish vaqt/, 'Ish vaqti'], [/telefon/, 'Telefon']];
/** «Manzil o'zgardi: …» — profil formasi yo'q, manzil va ish vaqti «Biznes haqida» sahifasida turadi */
const aboutChange: Intent = ctx => {
  const head = /^[^\d:]*:/.exec(ctx.raw)?.[0] ?? '';
  const field = ABOUT.find(([re]) => re.test(head.toLowerCase()))?.[1];
  if (!field || !/(o'zgar|yangi|endi|almash|ko'chdi|ko'chib)/.test(head.toLowerCase()) || !ctx.has('write_page')) return null;
  const done = got(ctx, 'write_page');
  if (done) return say(`«Biznes haqida» sahifasida yangiladim — ${field.toLowerCase()}. Mijozlarga endi yangisi aytiladi.`);
  const pageId = /- \[([\w-]+)\] Biznes haqida/.exec(ctx.system)?.[1];
  const value = ctx.raw.slice(head.length).trim();
  if (!pageId || !value) return say(`Yangi qiymatni ikki nuqtadan keyin yozing. Masalan: «${field} o'zgardi: …».`);
  const page = got(ctx, 'read_page');
  if (!page) return call('read_page', { page_id: pageId });
  const line = `- ${field}: ${value}`, old = new RegExp(`^- ${field}:.*$`, 'm');
  const text = String(page.json.text ?? '');
  // Almashtirish funksiya orqali: egasi yozgan qiymatdagi «$&» kabi belgilar maxsus ma'no olmasin
  return call('write_page', { page_id: pageId, title: page.json.title, text: (old.test(text) ? text.replace(old, () => line) : `${text.trim()}\n${line}`).slice(0, 2500) });
};

const page: Intent = ctx => {
  if (!/sahifa/.test(ctx.t) || !/(yoz|och|qo'sh|yarat)/.test(ctx.t)) return null;
  const done = got(ctx, 'write_page');
  if (done) return say(`«${done.json.saved.title}» sahifasini yozdim. Mijozlar so'rasa, shundan ham javob beraman; Obsidian'da ham ko'rinadi.`);
  const body = /^[^:]*:\s*([\s\S]+)$/.exec(ctx.raw)?.[1] ?? '';
  const cut = /\s+[—–-]\s+|\n|(?<=[.!?])\s+/.exec(body);
  if (!cut) return say("Sahifani bunday yozing: «Sahifa yoz: Sarlavha — matn».");
  return call('write_page', { title: body.slice(0, cut.index).trim().slice(0, 80), text: body.slice(cut.index + cut[0].length).trim().slice(0, 2500) });
};

interface Task { id: string; title: string; due_at: string | null; status: string }
const taskLine = (t: Task, now: Date): string => `${t.title}${t.due_at ? ` — ${dueLabel('uz', t.due_at, now)}` : ''}`;

const taskDone: Intent = ctx => {
  if (!/bajar(ildi|dim|dik|ib bo'ldim)|tugat(dim|ildi)|qilib bo'ldim|hal bo'ldi/.test(ctx.t) || /eslat/.test(ctx.t)) return null;
  const done = got(ctx, 'update_task');
  if (done) return say(`«${done.json.updated.title}» — bajarildi deb belgiladim.`);
  const list = got(ctx, 'list_tasks');
  if (!list) return call('list_tasks', { status: 'open' });
  const open: Task[] = list.json.tasks;
  const asked = new Set(stems(ctx.raw));
  const best = open.map(task => ({ task, hit: overlap(task.title, asked) })).sort((a, b) => b.hit - a.hit)[0];
  if (best && best.hit >= 0.5) return call('update_task', { task_id: best.task.id, status: 'done' });
  return say(open.length ? `Qaysi vazifa bajarildi? Ochiq vazifalar:\n${bullets(open.slice(0, 10).map(t => taskLine(t, ctx.now)))}` : "Ochiq vazifa yo'q.");
};

const TASK = /eslat|esimga sol|vazifa\s+(qo'sh|yoz|qo'y|och)|rejaga\s+(qo'sh|yoz)|unutma/;
const taskCreate: Intent = ctx => {
  if (!TASK.test(ctx.t)) return null;
  const done = got(ctx, 'create_task');
  if (done) {
    const made: Task = done.json.created;
    return say(made.due_at
      ? `Eslatma qo'ydim: «${made.title}» — ${dueLabel('uz', made.due_at, ctx.now)}. Vaqti kelganda Telegram'da eslataman.`
      : `Vazifa qo'shdim: «${made.title}» (muddatsiz). Jurnalda ko'rinadi.`);
  }
  const title = ctx.when.rest
    .replace(/\b(eslatib\s+(qo'y|tur)|eslat|esimga\s+sol|vazifa\s+(qo'sh|yoz|qo'y|och)|rejaga\s+(qo'sh|yoz)|unutmay)(ing|gin|asan)?\b/gi, ' ')
    .replace(/\b(menga|iltimos|kerakligini|kerak|deb)\b/gi, ' ')
    .replace(/\s+/g, ' ').replace(/^[\s:,.—–-]+|[\s:,.!—–-]+$/g, '').replace(/(?<=\p{L}{3})ni$/iu, '');
  if (title.length < 3) return say("Nimani eslatay? Masalan: «Ertaga soat 10 da bankka borishni eslat».");
  return call('create_task', { title: capital(title).slice(0, 200), due_at: dueAt(ctx.when, ctx.now) });
};

const DOCS: [RegExp, string][] = [[/shartnoma/, 'contract'], [/taklif/, 'offer'], [/hisob-faktura|faktura/, 'invoice'], [/xat\b/, 'letter']];
const paper: Intent = ctx => {
  const kind = DOCS.find(([re]) => re.test(ctx.t))?.[1];
  if (!kind || !/(tayyorla|yozib ber|tuzib ber|qilib ber|yoz$|tuz$)/.test(ctx.t)) return null;
  const done = got(ctx, 'create_document');
  if (done) return say("Hujjat fayli (.docx) tayyor — pastda. Eslatma: bu faqat bo'sh qolip. Hujjat MATNINI yozish — haqiqiy modelning ishi, taqlid miya buni qila olmaydi.");
  const title = capital(ctx.raw.replace(/\b(tayyorla|yozib ber|tuzib ber|qilib ber|yoz|tuz)(ing|gin)?\b/gi, ' ').replace(/\s+/g, ' ').trim()).slice(0, 120);
  const business = /^Name: (.+)$/m.exec(ctx.system)?.[1] ?? '________';
  return call('create_document', {
    title, kind,
    markdown: `# ${title}\n\n**${business}**\n\nSana: ${ctx.today}\n\n1. Tomonlar: ________\n2. Mazmuni: ________\n3. Narx va to'lov: ________\n4. Muddat: ________\n\nImzo: ________`,
  });
};

const followup: Intent = ctx => {
  if (!/mijozlar(im)?ga/.test(ctx.t) || !/(xabar|tabrik)/.test(ctx.t) || !/(yubor|tayyorla|yoz|jo'nat)/.test(ctx.t)) return null;
  if (/yuborma|jo'natma|yozma|kerak emas/.test(ctx.t)) return say("Xo'p — mijozlarga xabar tayyorlamadim.");
  const done = got(ctx, 'draft_followup');
  if (done) return say(`Xabar qoralamasi tayyor: Telegram orqali ${done.json.telegram_recipients} kishiga boradi. Hali yuborilmadi — pastdagi «Yuborish»ni bossangiz ketadi.`);
  const text = /[«"“]([^»"”]{3,})[»"”]/.exec(ctx.raw)?.[1] ?? /^[^:]*:\s*([\s\S]{3,})$/.exec(ctx.raw)?.[1];
  if (!text) return say("Xabar matnini ham yozing. Masalan: «Mijozlarga xabar tayyorla: Assalomu alaykum! Shanba kuni ham ishlaymiz». (Matnni o'zi yozish — haqiqiy modelning ishi.)");
  const list = got(ctx, 'list_leads');
  if (!list) return call('list_leads', {});
  const ids = (list.json.leads as { id: string; reachable: boolean }[]).filter(l => l.reachable).map(l => l.id);
  return ids.length ? call('draft_followup', { lead_ids: ids.slice(0, 200), text: text.trim().slice(0, 1500) }) : say("Hozircha xabar yuborsa bo'ladigan mijoz yo'q (mijoz avval botga yoki sizga yozgan bo'lishi kerak).");
};

const saveLead: Intent = ctx => {
  if (!/mijoz(ni)?\s+(qo'sh|yoz|saqla)|yangi mijoz|kontakt(ni)?\s+(qo'sh|saqla)/.test(ctx.t)) return null;
  const done = got(ctx, 'save_lead');
  if (done) return say(`Mijozni saqladim: ${[done.json.saved.name, done.json.saved.phone].filter(Boolean).join(', ')}. «Mijozlar» bo'limida ko'rinadi.`);
  const phone = parsePhone(ctx.raw);
  const body = (phone?.rest ?? ctx.raw).replace(/\b(yangi\s+)?mijoz(ni)?(\s+(qo'sh|yoz|saqla)(ing|gin)?)?|kontakt(ni)?\s+(qo'sh|saqla)\b/gi, ' ').replace(/^[\s:,.—–-]+/, '');
  const name = parseName(body);
  if (!name && !phone) return say("Mijozning ismi yoki telefonini yozing. Masalan: «Mijoz qo'sh: Aziz Karimov, +998 90 123 45 67, 2 ta implant so'radi».");
  const note = (name ? body.replace(new RegExp(name.split(' ').join(String.raw`\S*\s+`) + String.raw`\S*`), ' ') : body).replace(/^[\s:,.—–-]+|[\s,.—–-]+$/g, '').replace(/\s+/g, ' ');
  return call('save_lead', { ...(name ? { name } : {}), ...(phone ? { phone: phone.phone } : {}), ...(note.length > 2 ? { note: note.slice(0, 500) } : {}) });
};

const findPatient: Intent = ctx => {
  if (!/bemor(ni|ning)?\s.*(top|qidir|bormi)|(top|qidir)(ib ber)?\s.*bemor|bazada/.test(ctx.t)) return null;
  if (!ctx.has('find_patient')) return say(NO_CRM);
  const done = got(ctx, 'find_patient');
  if (done) {
    const list: Patient[] = done.json.patients;
    return say(list.length
      ? `Topildi (${done.json.total}):\n${bullets(list.map(p => `${patientLine(p)}${p.last_visit ? `, oxirgi tashrif ${p.last_visit}` : ''}${p.balance ? `, balans ${sum(p.balance)}` : ''}`))}`
      : 'Bunday bemor bazada topilmadi.');
  }
  const query = parseName(ctx.raw) ?? parsePhone(ctx.raw)?.phone ?? ctx.raw.replace(/\b(bemor(ni|ning)?|top(ib ber)?|qidir(ib ber)?|bazada|bormi)\b/gi, ' ').replace(/[?.!,:]+/g, ' ').replace(/\s+/g, ' ').trim();
  return query.length < 2 ? say("Kimni qidiray? Masalan: «Bemorni top: Valiyev».") : call('find_patient', { query: query.slice(0, 80) });
};

const freeSlots: Intent = ctx => {
  if (!/bo'sh\s+(vaqt|joy|o'rin|soat)|qachon bo'sh/.test(ctx.t)) return null;
  if (!ctx.has('free_slots')) return say(NO_CRM);
  const done = got(ctx, 'free_slots');
  if (!done) return call('free_slots', { date: ctx.when.date ?? ctx.today });
  const doctors: Doctor[] = done.json.doctors;
  return say(`${capital(dayText(done.json.date, ctx.now))} bo'sh vaqtlar:\n${bullets(doctors.map(d => `${d.doctor}${d.specialty ? ` (${d.specialty})` : ''}: ${d.off ?? (d.slots.length ? ranges(d.slots) : "bo'sh vaqt yo'q")}`))}`);
};

const PERIODS: [RegExp, string][] = [[/o'tgan hafta/, 'last_week'], [/o'tgan oy/, 'last_month'], [/7 kun/, 'last_7_days'], [/30 kun/, 'last_30_days'], [/hafta/, 'this_week'], [/oy/, 'this_month']];
const clinicPeriod: Intent = ctx => {
  if (!/(hafta|\boy\b|oylik|shu oy|o'tgan oy|7 kun|30 kun)/.test(ctx.t) || !/(hisobot|tushum|natija|qanday o'tdi|statistika|daromad)/.test(ctx.t)) return null;
  if (!ctx.has('clinic_period')) return say(NO_CRM);
  const done = got(ctx, 'clinic_period');
  if (!done) return call('clinic_period', { period: PERIODS.find(([re]) => re.test(ctx.t))![1] });
  const r = done.json, change = r.previous?.change_pct?.revenue;
  return say([
    `${r.from} — ${r.to} (${r.days} kun):`,
    `- Qabullar: ${r.appointments.total} ta, keldi ${r.appointments.came}, kelmadi ${r.appointments.no_show}, bekor ${r.appointments.cancelled}`,
    `- Tushum: ${sum(r.revenue.total)} (kuniga o'rtacha ${sum(Math.round(r.revenue.per_day_avg ?? 0))})`,
    ...(typeof change === 'number' ? [`- Oldingi davrga nisbatan tushum: ${change > 0 ? '+' : ''}${change}%`] : []),
    ...(r.best_day ? [`- Eng yaxshi kun: ${r.best_day.date} — ${sum(r.best_day.revenue)}`] : []),
  ].join('\n'));
};

const clinicAlerts: Intent = ctx => {
  if (!/nazorat|ogohlantirish|muammo|shubhali|xavotir/.test(ctx.t)) return null;
  if (!ctx.has('clinic_alerts')) return say(NO_CRM);
  const done = got(ctx, 'clinic_alerts');
  if (!done) return call('clinic_alerts', {});
  const alerts: string[] = done.json.alerts;
  return say(alerts.length ? `Nazorat (${done.json.checked}):\n${bullets(alerts)}` : `Nazorat (${done.json.checked}): e'tibor talab qiladigan narsa topilmadi.`);
};

const clinicCameras: Intent = ctx => {
  if (!/kamera/.test(ctx.t)) return null;
  if (!ctx.has('clinic_cameras')) return say(NO_CRM);
  const done = got(ctx, 'clinic_cameras');
  if (!done) return call('clinic_cameras', ctx.when.date ? { date: ctx.when.date } : {});
  const r = done.json, crm = typeof r.crm === 'object' ? ` CRM'da: «keldi» ${r.crm.marked_arrived} ta, to'lov ${r.crm.payments} ta.` : '';
  return say(`Kameralar (${r.date}): kresloga ${r.seated_in_chair} kishi o'tirdi, kassa oldida ${r.stood_at_cash_desk} kishi turdi.${crm}${r.findings.length ? `\n${bullets(r.findings)}` : "\nFarq topilmadi."}`);
};

const PAID: Record<string, string> = { Cash: 'naqd', Card: 'karta', Click: 'Click', Transfer: "o'tkazma" };
const clinicDay: Intent = ctx => {
  if (!/qabul|bemor|tushum|kassa|klinika|daromad|pul tushdi/.test(ctx.t)) return null;
  if (!ctx.has('clinic_day')) return say(NO_CRM);
  const done = got(ctx, 'clinic_day');
  if (!done) return call('clinic_day', ctx.when.date ? { date: ctx.when.date } : {});
  const r = done.json;
  const methods = Object.entries(r.revenue.by_method as Record<string, number>).map(([k, v]) => `${PAID[k] ?? k} ${sum(v)}`).join(', ');
  return say([
    `${capital(dayText(r.date, ctx.now))}: ${r.total} ta qabul — keldi ${r.came}, kutilmoqda ${r.expected}, kelmadi ${r.no_show}, bekor qilindi ${r.cancelled}.`,
    `Tushum: ${sum(r.revenue.total)}${methods ? ` (${methods})` : ''}.${r.unpaid.total ? ` To'lanmagan: ${sum(r.unpaid.total)} (${r.unpaid.count} ta).` : ''}`,
    ...(r.doctors as Json[]).map(d => `- ${d.doctor}: ${d.count} ta — ${(d.appointments as Json[]).map(a => `${a.time} ${a.patient}`).join(', ')}`),
  ].join('\n'));
};

const FROM: Record<string, string> = { customer: 'mijoz', owner: 'siz', cerebro: 'Cerebro' };
const conversations: Intent = ctx => {
  if (!/kim(lar)?\s+yoz|nima deb yoz|yozishma|xabarlar|nima so'ra/.test(ctx.t)) return null;
  const done = got(ctx, 'recent_conversations');
  if (!done) return call('recent_conversations', { limit: 10 });
  const list: Json[] = done.json.conversations;
  return say(list.length
    ? `Oxirgi yozishmalar:\n${bullets(list.map(c => `${c.name ?? 'Mijoz'} (${c.channel}) — ${FROM[c.last?.from] ?? ''}: «${String(c.last?.text ?? '').slice(0, 80)}»${c.reply_waiting_for_owner ? ' ⏳ javobingizni kutyapti' : ''}`))}`
    : 'Hali hech kim yozmagan.');
};

const leads: Intent = ctx => {
  if (!/mijozlar/.test(ctx.t)) return null;
  const done = got(ctx, 'list_leads');
  if (!done) return call('list_leads', {});
  const list: Json[] = done.json.leads;
  return say(list.length ? `Jami ${done.json.total} ta mijoz:\n${bullets(list.slice(0, 15).map(l => [l.name ?? (l.username ? `@${l.username}` : 'Mijoz'), l.phone, l.note].filter(Boolean).join(' — ')))}` : "Hali mijoz yo'q.");
};

const tasks: Intent = ctx => {
  if (!/vazifa|ishlarim|rejalar/.test(ctx.t)) return null;
  const done = got(ctx, 'list_tasks');
  if (!done) return call('list_tasks', { status: 'open' });
  const open: Task[] = done.json.tasks;
  return say(open.length ? `Ochiq vazifalar (${open.length}):\n${bullets(open.slice(0, 15).map(t => taskLine(t, ctx.now)))}` : "Ochiq vazifa yo'q.");
};

const summary: Intent = ctx => {
  if (!/bugun|xulosa|ahvol|holat|nima gap|nima qil/.test(ctx.t)) return null;
  const done = got(ctx, 'get_summary');
  if (!done) return call('get_summary', {});
  const s = done.json, line = (list: Task[]) => list.map(t => taskLine(t, ctx.now)).join('; ');
  return say([
    `Bugun ${s.tasks.today.length} ta vazifa${s.tasks.today.length ? `: ${line(s.tasks.today)}` : ''}.`,
    ...(s.tasks.overdue.length ? [`Kechikkan ${s.tasks.overdue.length} ta: ${line(s.tasks.overdue)}.`] : []),
    ...(s.tasks.upcoming.length ? [`Keyingi kunlarda: ${line(s.tasks.upcoming.slice(0, 5))}.`] : []),
    `Oxirgi 7 kunda yangi mijozlar: ${s.customers.new_last_7_days} ta.`,
    ...(s.waiting_for_owner.followup_drafts ? [`Tasdig'ingizni kutayotgan xabar qoralamalari: ${s.waiting_for_owner.followup_drafts} ta.`] : []),
  ].join('\n'));
};

const greeting: Intent = ctx => (/^(assalomu alaykum|salom|xayrli (tong|kun|kech))[\s!.,]*$/.test(ctx.t) ? say('Assalomu alaykum! Nima qilamiz?') : null);
const photo: Intent = ctx => (ctx.raw.includes('<photo_description>') ? say(`Rasm tavsifi keldi:\n${ctx.raw.split('<photo_description>')[1]?.split('</photo_description>')[0].trim().slice(0, 600)}\n\nRasm bilan ishlash (chekni xarajatga yozish va h.k.) — haqiqiy modelning ishi; taqlid miya faqat tavsifni ko'rsatadi.`) : null);

/** Tartib muhim: aniqroq niyat oldin («Rustamovga 3 mln ulush berdim» — xarajat emas, shifokorga to'lov) */
const INTENTS: Intent[] = [photo, greeting, payDoctor, payment, expense, booking, remember, prices, aboutChange, page, taskDone, taskCreate, paper, followup, saveLead, findPatient, freeSlots, clinicPeriod, clinicAlerts, clinicCameras, clinicDay, conversations, leads, tasks, summary];

export const EXAMPLES = [
  'Ertaga soat 10 da bankka borishni eslat',
  'Bugun nima qilishim kerak?',
  'Vazifalar',
  'Bankka borishni bajardim',
  "Eslab qol: yakshanba kuni ishlamaymiz",
  'Narxlarni saqla: Plomba 400 ming, Vinir 1,9 mln',
  "Manzil o'zgardi: Yunusobod 4-mavze, 15-uy",
  "Mijoz qo'sh: Aziz Karimov, +998 90 123 45 67, implant so'radi",
  'Kim yozdi?',
  'Bugungi qabullar va tushum',
  "O'tgan hafta hisoboti",
  "Ertaga bo'sh vaqt bormi?",
  'Bemorni top: Valiyev',
  'Ali Valiyevni ertaga 15:00 ga Rustamovga yoz',
  "Ali Valiyev 350 ming to'ladi, karta, Rustamov",
  'Ijaraga 2 million ketdi',
  'Rustamovga 3 million ulush berdim',
  'Kamera hisobi',
];
const UNKNOWN = `Bu gapni tushunmadim. Men — taqlid miya: faqat tayyor qoidalar bo'yicha ishlayman, erkin gapni haqiqiy model (Claude) tushunadi.\nMen tushunadigan gaplar:\n${bullets(EXAMPLES)}`;

/** Yordamchi o'rnida: egasining gapiga keyingi qadam — asbob chaqirish yoki javob */
export function ownerTurn(messages: Msg[], tools: Block[], system = ''): Turn {
  const turn = readTurn(messages);
  const stamped = STAMP.exec(turn.text);
  const now = stamped ? new Date(`${stamped[1]}T${stamped[2]}:00`) : new Date();
  const raw = clean(stamped ? turn.text.slice(stamped[0].length) : turn.text);
  const offered = new Set(tools.map(t => String(t.name)));
  const failed = turn.calls.find(c => !c.ok);
  if (failed) return say(`Bajarilmadi: ${failed.text}`);
  if (turn.calls.length >= MAX_STEPS) return say("Ish ko'p qadamli chiqdi — to'xtatdim. Gapni soddaroq qilib qayta yozing.");
  const ctx: Ctx = { raw, t: raw.toLowerCase(), now, today: iso(now), when: parseWhen(raw, now), calls: turn.calls, has: name => offered.has(name), system };
  try {
    for (const intent of INTENTS) {
      const out = intent(ctx);
      if (out) return out;
    }
  } catch (e) {
    // Asbob natijasi kutilgan ko'rinishda bo'lmasa — yiqilmaydi (server buni «AI band» deb ko'rsatardi), ochiq aytadi
    return say(`Taqlid miya asbob natijasini o'qiy olmadi (${(e as Error).message}).`);
  }
  return say(UNKNOWN);
}

