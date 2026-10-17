/**
 * Stend uchun «taqlid miya», mijoz tomoni: mijozga javob beruvchi model o'rnida (egasi tomoni — scripts/stendBrain.ts).
 * Qoida haqiqiy modelga berilgan ko'rsatma bilan bir xil: faqat modelga berilgan bilimdan javob beradi (tasdiqlangan savol-javob,
 * narxlar jadvali, egasining sahifalari, faktlar); bilmaganini o'ylab topmaydi — egasidan so'raydi; qabulga faqat shifokor, kun,
 * aniq soat, ism-familiya va telefon — hammasi mijozning o'z gapida bo'lgandagina yozadi.
 * Bu modelning aqli EMAS: so'zlar ustma-ust tushishiga qaraydi, gapning ma'nosini tushunmaydi.
 */
import { DAYS, dayLong, fromIso, weekday } from '../src/lib/week';
import { capital, fold, low, overlap, parseName, parsePhone, parseWhen, plainName, ranges, stems, sum } from './stendParse';

type Decision = Record<string, string>;
interface Line { customer: boolean; text: string }
interface Told { name: string; phone: string }
interface Schedule { id: string; name: string; days: Map<string, string[]> }
interface Talk { user: string; clinic: boolean; lines: Line[]; burst: string[]; said: string; t: string; now: Date; told: Told; doctors: Schedule[] }

const HELLO = 'Assalomu alaykum! Qanday yordam bera olaman?';
const WILL_CHECK = 'Savolingizni oldim, aniqlab javob beraman.';
const GREETING = /^(assalomu alaykum|va alaykum assalom|salom|hayrli kun|xayrli (tong|kun|kech))[\s!.,]*/i;
const THANKS = /^(katta )?(rahmat|raxmat|ok|okay|xo'p|hop|tushunarli|yaxshi|mayli|kutaman|bo'pti)[\s.!,)]*$/;
const STOP = new Set(['salom', 'assalomu', 'alaykum', 'bormi', 'qanday', 'qilasizmi', 'mumkinmi', 'kerak', 'uchun', 'bilan', 'iltimos', 'rahmat', 'sizlarda', 'sizda', 'menga', 'aytsangiz', "bo'ladimi", 'qancha', 'turadi', 'narxi', 'narxini', 'narxlari', 'ayting', 'bering']);
/** Qabulga yozilish niyati. «Bolalarni qabul qilasizmi?» — savol, yozilish emas: yolg'iz «qabul» so'zi kirmaydi */
const WANTS_VISIT = /yozil|yozdir|yozib qo'y|(meni|bizni|o'g'limni|qizimni|onamni|otamni)\s(.*\s)?yoz|qabulga|qabul vaqt|navbat|ko'rikka|kelmoqchi|bormoqchi|bo'sh vaqt|vaqt bormi|kelsam bo'l|ko'rsatmoqchi|konsultatsiyaga|записа/;

const between = (text: string, tag: string): string => new RegExp(`<${tag}>\\n([\\s\\S]*?)\\n</${tag}>`).exec(text)?.[1] ?? '';
const best = <T extends { hit: number }>(list: T[]): T | undefined => [...list].sort((a, b) => b.hit - a.hit)[0];

/**
 * Mijoz yozishmada o'zi aytgan ism-familiya va telefon (oxirgi aytilgani). Shifokorning ismi («Rustam Rustamovga yozilmoqchiman») —
 * bemorning ismi emas: u ism deb olinmaydi
 */
function toldBy(lines: Line[], doctors: Schedule[]): Told {
  let name = '', phone = '', asked = false;
  for (const line of lines) {
    // Kichik harfli ikki so'z faqat biz ism-familiyani so'raganimizdan keyingi javobda ism deb olinadi
    if (!line.customer) { asked = /ism-familiya/i.test(line.text); continue; }
    const hit = parsePhone(line.text);
    if (hit) phone = hit.phone;
    const rest = (hit?.rest ?? line.text).replace(/[,.;:!]+/g, ' ').replace(/\s+/g, ' ').trim();
    const stated = parseName(rest) ?? plainName(/ism(?:im|i)?(?:-sharif(?:im)?)?\s+([\p{L}']+\s+[\p{L}']+)/iu.exec(rest)?.[1]) ?? (asked ? plainName(rest) : null);
    if (stated) name = stated.split(' ').map(capital).join(' ');
  }
  return { name: doctors.some(d => fold(d.name) === fold(name)) ? '' : name, phone };
}

function readTalk(user: string): Talk {
  const lines = between(user, 'conversation').split('\n').flatMap(l => {
    const m = /^\[[^\]]*\] (Customer|Business \((?:owner|assistant)\)): (.*)$/.exec(l);
    return m ? [{ customer: m[1] === 'Customer', text: m[2] }] : [];
  });
  // Javobsiz qolgan gaplar: bizning oxirgi xabarimizdan keyingilari
  const burst = lines.slice(lines.findLastIndex(l => !l.customer) + 1).map(l => l.text);
  const stamped = /^Now: (\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/m.exec(user);
  const said = burst.join(' '), doctors = readSchedule(between(user, 'clinic_schedule'));
  return { user, clinic: user.includes('<clinic_schedule>'), lines, burst, said, t: low(said), now: stamped ? new Date(`${stamped[1]}T${stamped[2]}:00`) : new Date(), told: toldBy(lines, doctors), doctors };
}

function decision(talk: Talk, action: string, reply: string, extra: Decision = {}): Decision {
  return {
    action, reply, question: '', note_for_owner: '', lead_note: '', customer_name: talk.told.name, customer_phone: talk.told.phone,
    ...(talk.clinic ? { book_doctor_id: '', book_date: '', book_time: '' } : {}), ...extra,
  };
}
const askOwner = (talk: Talk, note: string, question = '', reply = WILL_CHECK): Decision => decision(talk, 'ask_owner', reply, { note_for_owner: note, question });

// ─── Bilimdan javob ──────────────────────────────────────────────────────────

interface Known { reply: string; note: string }

/** Modelga berilgan bilim → «bitta savolga javob» funksiyasi. Bilimda yo'q bo'lsa — null: o'ylab topilmaydi */
function knowledge(user: string): (text: string) => Known | null {
  const block = between(user, 'owner_knowledge');
  const answers = [...block.matchAll(/^Q: (.+)\nA: (.+)$/gm)].map(m => ({ q: m[1], a: m[2] }));
  // Profildagi «- Nom: 350000» qatorlari
  const offerings = [...between(user, 'business_profile').matchAll(/^- (.+?): (\d+)$/gm)].map(m => ({ name: m[1].split(' / ')[0], price: Number(m[2]) })).filter(o => o.price > 0);
  // Egasi yozgan sahifalar: «- Sarlavha: matn» (matn ichida «- Manzil: …» kabi qatorlar bo'ladi)
  const pages = [...block.matchAll(/^- ([^:\n]{2,80}): (.+)$/gm)].map(m => ({ title: m[1], text: m[2] }));
  const facts = [...between(user, 'saved_facts').matchAll(/^- (.+)$/gm)].map(m => m[1]);
  const field = (label: string): string => { for (const p of pages) { const m = new RegExp(`${label}:\\s*(.+?)(?= - |$)`, 'i').exec(p.text); if (m) return m[1].trim(); } return ''; };

  return text => {
    const q = low(text), asked = new Set(stems(text, STOP));
    const qa = best(answers.map(x => ({ ...x, hit: overlap(x.q, asked, STOP) })));
    if (qa && qa.hit >= 0.6) return { reply: qa.a, note: qa.q };
    if (/narx|qancha|necha pul|nech pul|turadi|сколько/.test(q)) {
      // Savoldagi hamma mazmunli so'z xizmat nomida bo'lishi shart: «Tish oqartirish» so'ralganda «Tish olish» narxi aytilmaydi
      const fits = asked.size ? offerings.filter(o => { const name = new Set(stems(o.name)); return [...asked].every(w => name.has(w)); }) : [];
      if (fits.length === 1) return { reply: `${fits[0].name} — ${sum(fits[0].price)}.`, note: `Narx so'radi: ${fits[0].name}` };
      if (/narxlar|narxnoma|prays/.test(q) && offerings.length) return { reply: `Narxlarimiz: ${offerings.slice(0, 8).map(o => `${o.name} — ${sum(o.price)}`).join('; ')}.`, note: "Narxlarni so'radi" };
    }
    if (/manzil|qayerda|qaerda|adres|boriladi|joylash/.test(q) && field('Manzil')) return { reply: `Manzilimiz: ${field('Manzil')}.`, note: "Manzilni so'radi" };
    if (/ish vaqt|nechchi|qachon ishlay|soat nech|ochiq|nechagacha|dam olish/.test(q) && field('Ish vaqti')) return { reply: `Ish vaqtimiz: ${field('Ish vaqti')}.`, note: "Ish vaqtini so'radi" };
    // «Mening raqamim 90…» — mijoz o'z raqamini aytyapti, bizning telefonni so'ramayapti
    if (/telefon(ingiz)?|raqamingiz|qo'ng'iroq qil/.test(q) && !parsePhone(text) && field('Telefon')) return { reply: `Telefonimiz: ${field('Telefon')}.`, note: "Telefonni so'radi" };
    const written = best(pages.map(p => ({ ...p, hit: overlap(p.title, asked) })));
    if (written && written.hit >= 0.5) return { reply: written.text.split(/(?<=[.!?]) /).slice(0, 2).join(' '), note: `So'radi: ${written.title}` };
    const fact = best(facts.map(line => ({ line, hit: overlap(line, asked) })));
    return fact && fact.hit >= 0.5 ? { reply: fact.line, note: '' } : null;
  };
}

/** Javobsiz gaplar alohida savollarga bo'linadi (salom-alik va «rahmat»siz) */
const questionsIn = (burst: string[]): string[] =>
  burst.flatMap(x => x.split(/(?<=[?!.])\s+/)).map(x => x.replace(GREETING, '').replace(/\s+/g, ' ').trim()).filter(x => /\p{L}/u.test(x) && !THANKS.test(low(x)));

/** Bilgani aytiladi, bilmagani egasidan so'raladi */
function fromKnowledge(talk: Talk, found: { text: string; hit: Known | null }[]): Decision {
  const replies = [...new Set(found.flatMap(f => (f.hit ? [f.hit.reply] : [])))];
  const open = found.filter(f => !f.hit).map(f => f.text);
  const leadNote = (found.find(f => f.hit?.note)?.hit?.note ?? '').slice(0, 60);
  if (!open.length) return decision(talk, 'reply', replies.join(' '), { lead_note: leadNote });
  // Umumiy savol bitta bo'lsa — egasining javobi keyin eslab qolinishi mumkin («Eslab qolaymi?»)
  const question = open.length === 1 ? (/\?$/.test(open[0]) ? open[0] : `${open[0]}?`).slice(0, 300) : '';
  const reply = [...replies, replies.length ? 'Qolgan savolingizni aniqlab, javob beraman.' : WILL_CHECK].join(' ');
  return decision(talk, 'ask_owner', reply, { note_for_owner: `Mijoz so'rayapti: ${open.join(' / ').slice(0, 300)}`, question, lead_note: leadNote });
}

// ─── Resepshn ────────────────────────────────────────────────────────────────

/** <clinic_schedule> matni → shifokorlar va kunlar bo'yicha bo'sh vaqtlar («11:00–17:30» — har yarim soatda) */
function readSchedule(text: string): Schedule[] {
  const out: Schedule[] = [];
  for (const line of text.split('\n')) {
    const doctor = /^- doctor_id (\S+) — ([^,]+)/.exec(line);
    if (doctor) { out.push({ id: doctor[1], name: doctor[2].trim(), days: new Map() }); continue; }
    const day = /^\s+(\d{4}-\d{2}-\d{2}) \([^)]*\): (.+)$/.exec(line);
    if (!day || !out.length) continue;
    out.at(-1)!.days.set(day[1], day[2].split(', ').flatMap(part => {
      const m = /^(\d{2}):(\d{2})(?:–(\d{2}):(\d{2}))?$/.exec(part.trim());
      if (!m) return [];
      const from = Number(m[1]) * 60 + Number(m[2]), to = m[3] ? Number(m[3]) * 60 + Number(m[4]) : from;
      return Array.from({ length: Math.floor((to - from) / 30) + 1 }, (_, i) => { const at = from + i * 30; return `${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`; });
    }));
  }
  return out;
}

const dayLabel = (date: string): string => `${dayLong('uz', fromIso(date))} (${DAYS.uz[weekday(fromIso(date))].toLowerCase()})`;

/**
 * Qabulga yozilish: jadvaldagi bo'sh vaqtni taklif qiladi; shifokor, kun, ANIQ soat, ism-familiya va telefon to'liq bo'lsagina «book».
 * Qabulga tegishli gap bo'lmasa — null (oddiy savol sifatida javob beriladi).
 */
function reception(talk: Talk): Decision | null {
  const { doctors } = talk, patient = talk.told.name;
  // Oxirgi yozilgan qabuldan keyingi gaplar: eski qabulning kuni va vaqti yangisiga o'tib ketmasin
  const since = talk.lines.slice(talk.lines.findLastIndex(l => !l.customer && /📅|yozdik/.test(l.text)) + 1).filter(l => l.customer).map(l => l.text);
  if (!doctors.length || !since.some(x => WANTS_VISIT.test(low(x)))) return null;

  // Mijozning o'z ismi shifokor ismi bilan adashtirilmaydi («Madina Aliyeva» — bemor; shifokor Nodira Aliyeva tanlanmaydi)
  const own = fold(patient).split(' ').filter(w => w.length > 2);
  const mentioned = (text: string): Schedule | undefined => {
    const rest = own.reduce((s, w) => s.replaceAll(w, ' '), fold(text));
    return doctors.find(d => fold(d.name).split(' ').some(w => w.length > 3 && rest.includes(w)));
  };
  const info = since.reduce<{ date: string | null; time: string | null; doctor: Schedule | undefined }>((got, text) => {
    const when = parseWhen(text, talk.now);
    return { date: when.date ?? got.date, time: when.time ?? got.time, doctor: mentioned(text) ?? got.doctor };
  }, { date: null, time: null, doctor: undefined });

  // Oxirgi gap qabulga tegishli bo'lmasa (masalan, yo'l-yo'lakay narx so'radi) — oddiy savol sifatida javob beriladi
  const latest = parseWhen(talk.said, talk.now), earlier = toldBy(talk.lines.slice(0, talk.lines.length - talk.burst.length), doctors);
  const gave = earlier.name !== talk.told.name || earlier.phone !== talk.told.phone;
  if (!WANTS_VISIT.test(talk.t) && !latest.date && !latest.time && !latest.part && !mentioned(talk.said) && !gave) return null;

  const pool = info.doctor ? [info.doctor] : doctors;
  const freeOn = (date: string): string => pool.filter(d => d.days.get(date)?.length).map(d => `${d.name} — ${ranges(d.days.get(date)!)}`).join('; ');
  const dates = [...new Set(doctors.flatMap(d => [...d.days.keys()]))].sort();
  const open = dates.filter(freeOn);
  const wants = { lead_note: 'Qabulga yozilmoqchi' };
  const offer = (lead: string): Decision => decision(talk, 'reply', `${lead}${open.slice(0, 2).map(d => `${dayLabel(d)}: ${freeOn(d)}`).join('. ')}. Qaysi kun va vaqt sizga qulay?`, wants);
  if (!open.length) return askOwner(talk, "Bemor qabulga yozilmoqchi, lekin yaqin 7 kunda bo'sh vaqt yo'q");
  if (!info.date && !info.time) return offer("Yaqin bo'sh vaqtlar — ");
  const date = info.date ?? open.find(d => pool.some(doc => doc.days.get(d)?.includes(info.time!)));
  if (!date) return offer(`Afsuski, soat ${info.time} ga bo'sh vaqt topilmadi. Bo'sh vaqtlar — `);
  if (!dates.includes(date)) return askOwner(talk, `Bemor ${date} kuniga yozilmoqchi — bu kun jadvalda yo'q (yozishmada faqat yaqin 7 kunga yoziladi)`);
  if (!freeOn(date)) return offer(`Afsuski, ${dayLabel(date)} kuni qabul yo'q. Yaqin bo'sh vaqtlar — `);
  // Kun aytilgan, aniq soat aytilmagan («ertaga ertalab») — soat o'ylab topilmaydi, shu kunning bo'sh vaqtlari so'raladi
  if (!info.time) return decision(talk, 'reply', `${capital(dayLabel(date))} kuni bo'sh vaqtlar: ${freeOn(date)}. Qaysi vaqt qulay?`, wants);
  const doctor = pool.find(d => d.days.get(date)?.includes(info.time!));
  if (!doctor) return decision(talk, 'reply', `Afsuski, ${dayLabel(date)} soat ${info.time} band. Shu kuni bo'sh vaqtlar: ${freeOn(date)}. Qaysi biri qulay?`, wants);
  const full = patient.split(' ').length >= 2;
  if (!full || !talk.told.phone) {
    const need = !full && !talk.told.phone ? 'ism-familiyangiz va telefon raqamingizni' : !full ? 'ism-familiyangizni' : 'telefon raqamingizni';
    return decision(talk, 'reply', `${capital(dayLabel(date))} soat ${info.time}, ${doctor.name} — bo'sh. Qabulni rasmiylashtirish uchun ${need} yuboring.`, wants);
  }
  return decision(talk, 'book', `Sizni ${dayLabel(date)} kuni soat ${info.time} ga yozdik. Kutamiz!`, {
    book_doctor_id: doctor.id, book_date: date, book_time: info.time, lead_note: `Qabul: ${date} ${info.time}, ${doctor.name}`.slice(0, 100),
  });
}

// ─── Qaror ───────────────────────────────────────────────────────────────────

function answer(user: string): Decision {
  const talk = readTalk(user);
  if (!talk.burst.length) return decision(talk, 'ignore', '');
  if (THANKS.test(talk.t)) return talk.lines.some(l => !l.customer) ? decision(talk, 'ignore', '') : decision(talk, 'reply', HELLO);
  const known = knowledge(user);
  const found = questionsIn(talk.burst).map(text => ({ text, hit: known(text) }));
  if (talk.clinic) {
    if (/ko'chir|bekor qil|kela olmayman|boshqa kunga|boshqa vaqtga/.test(talk.t)) return askOwner(talk, "Bemor qabulini ko'chirmoqchi yoki bekor qilmoqchi — CRM'da o'zgartirib, o'zingiz javob bering");
    // Og'riq yoki shikoyat — odam javob beradi (tashxis va maslahat berilmaydi). «Tozalash og'riydimi?» — oddiy savol, bu yerga tushmaydi
    if (/og'riyap|og'rib|shishib|shish(di|gan)|qonayap|qon ket|yiring|shikoyat/.test(talk.t)) return askOwner(talk, "Bemor og'riq yoki shikoyat haqida yozdi — o'zingiz javob bering", '', 'Tushunarli. Shifokor bilan aniqlab, tez orada javob beraman.');
    // Hamma savolning javobi bilimda bo'lsa — bu savol, qabulga yozilish emas («Bolam bilan kelmoqchiman, bolalarni qabul qilasizlarmi?»)
    const visit = found.length && found.every(f => f.hit) ? null : reception(talk);
    if (visit) return visit;
  }
  return found.length ? fromKnowledge(talk, found) : decision(talk, 'reply', HELLO);
}

/** Mijozga javob beruvchi model o'rnida. Qaytadi — serverdagi sxemaga mos qaror */
export function customerTurn(user: string): Decision {
  try {
    return answer(user);
  } catch (e) {
    // Yiqilmaydi: xabar javobsiz qolmasin — egasiga o'tadi
    const book: Decision = user.includes('<clinic_schedule>') ? { book_doctor_id: '', book_date: '', book_time: '' } : {};
    return { action: 'ask_owner', reply: WILL_CHECK, question: '', note_for_owner: `Taqlid miya bu xabarni o'qiy olmadi (${(e as Error).message}) — o'zingiz javob bering`, lead_note: '', customer_name: '', customer_phone: '', ...book };
  }
}
