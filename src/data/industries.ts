import { isMedical } from '../lib/compliance';
import { CLINIC_PACK, GENERAL_PACK, type PackQuestion } from './brainPack';

/**
 * Soha profillari: klinika, o'quv markazi, xizmat ko'rsatuvchi (IT, agentlik, qurilish), ishlab chiqarish, savdo.
 * Har biri — standart: mijozlar ko'p so'raydigan savollar, mijozni qanday atash, mijoz necha kun e'tiborsiz qolsa «unutilgan»
 * va yordamchiga shu soha egasining odatdagi ishi haqida ko'rsatma. Biznesning o'z ma'lumoti (narx, tarif, mijozlar) bu yerda yo'q —
 * uni egasi kiritadi; profil faqat qaysi narsalarni so'rash va nimaga e'tibor berishni biladi.
 */
export type IndustryKind = 'clinic' | 'education' | 'services' | 'manufacturing' | 'retail';

export interface IndustryProfile {
  kind: IndustryKind;
  label: string;
  /** Mijozni qanday atash: kunlik rejada va xabarlarda */
  customer: { one: string; many: string };
  pack: PackQuestion[];
  /** Faol mijoz shuncha kun hech kim bilan gaplashilmasa — rejada «unutilgan» bo'lib chiqadi */
  followDays: number;
  /** Yordamchiga (model): shu soha egasining odatdagi ishi va nimaga e'tibor berish (inglizcha — tizim ko'rsatmasi tilida) */
  playbook: string;
}

export const EDUCATION_PACK: PackQuestion[] = [
  { id: 'trial', question: 'Sinov darsi bormi, pullikmi?', hint: "Masalan: birinchi dars bepul, oldindan yoziling" },
  { id: 'schedule', question: 'Darslar qachon bo\'ladi, guruh vaqtlari qanday?', hint: "Masalan: haftada 3 marta, 9:00, 14:00 va 18:00 guruhlari" },
  { id: 'group', question: 'Guruhda necha kishi o\'qiydi, yakka dars bormi?', hint: "Masalan: 8–12 kishi; yakka dars ham bor, narxi alohida" },
  { id: 'teachers', question: "O'qituvchilar kimlar, tajribasi qanday?", hint: "Masalan: IELTS 8.0 sertifikatli, 5 yildan ortiq tajriba" },
  { id: 'results', question: "Qanday natija beradi, sertifikat yoki imtihon bormi?", hint: "Masalan: 6 oyda B2; kurs oxirida sertifikat; o'tgan yili 40 o'quvchi universitetga kirdi" },
  { id: 'payment', question: "To'lov qanday: oylikmi, kursga birdanmi?", hint: "Masalan: oyiga 400 000 so'm, har oyning 5-sanasigacha; Click, Payme" },
  { id: 'discount', question: 'Chegirma bormi?', hint: "Masalan: aka-uka uchun 10%, 3 oyga birdan to'lansa 5%" },
  { id: 'age', question: 'Necha yoshdan qabul qilasiz?', hint: 'Masalan: 7 yoshdan; kattalar uchun alohida guruh' },
  { id: 'online', question: "Onlayn o'qish mumkinmi?", hint: "Masalan: ha, Zoom orqali; oflayn bilan narxi bir xil" },
  { id: 'missed', question: "Dars qoldirilsa nima bo'ladi?", hint: "Masalan: sababli bo'lsa boshqa guruhda qoplanadi; to'lov qaytarilmaydi" },
  { id: 'route', question: 'Markazga qanday boriladi?', hint: "Masalan: mo'ljal — Korzinka ro'parasi, 2-qavat" },
];

export const SERVICES_PACK: PackQuestion[] = [
  { id: 'process', question: 'Ish qanday boshlanadi, bosqichlari qanday?', hint: "Masalan: tanishuv uchrashuvi → taklif → shartnoma → ish → topshirish" },
  { id: 'timeline', question: 'Qancha vaqtda bajariladi?', hint: "Masalan: oddiy loyiha 2–3 hafta; aniq muddat shartnomada" },
  { id: 'payment', question: "To'lov sharti qanday?", hint: "Masalan: 50% oldindan, 50% topshirilganda; pul o'tkazish yoki karta" },
  { id: 'contract', question: 'Shartnoma, hisob-faktura beriladimi?', hint: "Masalan: ha, rasmiy shartnoma va hisob-faktura; QQS bilan yoki QQSsiz" },
  { id: 'demo', question: "Oldin ko'rib, sinab ko'rsa bo'ladimi?", hint: "Masalan: ha, bepul demo; 7 kunlik sinov muddati" },
  { id: 'portfolio', question: 'Avval kimlar bilan ishlagansiz?', hint: "Masalan: 15 ta klinika, 3 ta o'quv markazi; nomlarini ruxsat bilan aytamiz" },
  { id: 'support', question: "Topshirgandan keyin yordam berasizmi?", hint: "Masalan: 3 oy bepul qo'llab-quvvatlash, keyin oylik to'lov" },
  { id: 'discount', question: 'Chegirma bormi?', hint: "Masalan: yillik to'lovda 15%; tavsiya bilan kelganlarga 10%" },
  { id: 'meeting', question: "Ofisga kelish kerakmi yoki onlayn ham bo'ladimi?", hint: "Masalan: onlayn ham bo'ladi; kerak bo'lsa o'zimiz boramiz" },
];

export const MANUFACTURING_PACK: PackQuestion[] = [
  { id: 'min_order', question: 'Eng kam buyurtma qancha?', hint: "Masalan: 100 dona yoki 1 tonna; kamiga ulgurji narx yo'q" },
  { id: 'wholesale', question: 'Ulgurji narx qanday hisoblanadi?', hint: "Masalan: 500 donadan 5%, 1000 donadan 10% chegirma" },
  { id: 'lead_time', question: 'Buyurtma necha kunda tayyor bo\'ladi?', hint: "Masalan: ombordagi — darhol; yangi partiya 10–14 kun" },
  { id: 'delivery', question: 'Yetkazib berasizmi, viloyatlarga ham?', hint: "Masalan: Toshkent ichida bepul; viloyatlarga transport kompaniyasi orqali, haqi alohida" },
  { id: 'samples', question: "Namuna olsa bo'ladimi?", hint: "Masalan: ha, 3 tagacha namuna bepul; zavodga kelib ko'rish mumkin" },
  { id: 'quality', question: 'Sertifikat, sifat hujjatlari bormi?', hint: "Masalan: GOST bo'yicha, har partiyaga sertifikat" },
  { id: 'payment', question: "To'lov sharti qanday?", hint: "Masalan: 30% oldindan, qolgani yuklanganda; pul o'tkazish, QQS bilan" },
  { id: 'custom', question: "Buyurtmachi o'lchami yoki brendi bilan qilasizmi?", hint: "Masalan: ha, 500 donadan; logotip bosish qo'shimcha" },
  { id: 'warranty', question: 'Kafolat bormi, nuqsonli mahsulot almashtiriladimi?', hint: 'Masalan: 1 yil kafolat; nuqson 10 kun ichida almashtiriladi' },
  { id: 'route', question: "Zavod yoki omborga qanday boriladi?", hint: "Masalan: Sergeli sanoat zonasi, 5-ko'cha; ish kunlari 9–18" },
];

const COMMON_PLAYBOOK = `Next steps: every active customer should have a next step. When you save or update a customer and the next action is clear (call back, send a proposal, a meeting, a visit), set next_step and next_at. When the owner reports how a meeting, call or visit went, update that customer (stage, note, next step) and create the next task if one is needed. After a report or a summary, suggest the single most useful next action, not a list of ideas.`;

const PROFILES: Record<IndustryKind, Omit<IndustryProfile, 'kind'>> = {
  clinic: {
    label: 'Klinika', customer: { one: 'bemor', many: 'bemorlar' }, pack: CLINIC_PACK, followDays: 1,
    playbook: `This is a clinic. The owner's day: patients booked by phone and messengers, doctors' load, who came and who did not, payments, staff. What usually needs attention: patients who did not come (offer to call and rebook), patients who have not returned for 6–12 months (a recall list for the reception), unanswered patient messages (answer the same day, ideally within an hour), revenue and load compared to a usual day, reviews. A new inquiry left without a reply until tomorrow is usually a lost patient. Documents the owner typically asks for: a treatment plan with prices, a price list, a patient consent form, a contract with a doctor. Patients are people, not leads: never give medical advice or promise results; questions about pain, swelling or complications go to the owner or a doctor.`,
  },
  education: {
    label: "O'quv markazi", customer: { one: "o'quvchi", many: "o'quvchilar" }, pack: EDUCATION_PACK, followDays: 2,
    playbook: `This is an education business (a learning centre, courses, a school). The owner's work: inquiries from parents and students turn into a trial lesson, then into a group; monthly payments and who has not paid yet; group fill rate and schedule; teachers; parents' questions about progress. What usually needs attention: inquiries not invited to a trial lesson within a day, students who came to a trial but did not enrol (follow up once, kindly), payment reminders around the due date, groups that are almost full or too small. Documents: a contract with parents, a schedule, an invoice, a certificate, an announcement for parents. Messages to parents are polite and short; never shame anyone for a late payment.`,
  },
  services: {
    label: "Xizmat ko'rsatish", customer: { one: 'mijoz', many: 'mijozlar' }, pack: SERVICES_PACK, followDays: 3,
    playbook: `This is a services business selling to other businesses or people (IT, an agency, construction or repair, consulting). A deal moves: first contact → meeting or demo → proposal → contract → payment → delivery → support. What usually needs attention: prospects with no next step, proposals sent without an answer for 2–3 days (follow up once with something useful), meetings without a recorded outcome, signed contracts waiting for payment. Documents: a commercial proposal, a contract, an invoice, an act of completed work. When the owner asks to find potential customers, use web search, then save each real company you found as a customer with source "internet" and stage new (only with a public phone, site or address; at most 20 per request; never invent), and offer a short first message they can send.`,
  },
  manufacturing: {
    label: 'Ishlab chiqarish', customer: { one: 'buyurtmachi', many: 'buyurtmachilar' }, pack: MANUFACTURING_PACK, followDays: 5,
    playbook: `This is a manufacturer or a wholesaler. Buyers are dealers, shops and companies. The owner's work: quotes and price requests, orders and production deadlines, shipments and deliveries, money owed for shipped goods, raw-material suppliers. What usually needs attention: quotes sent without an answer, orders whose deadline is close, buyers who owe for a shipment, regular buyers who have not ordered for longer than usual. Documents: a price list, a quote (commercial proposal), a supply contract, an invoice, a delivery note. When the owner asks to find new dealers or buyers, use web search, then save each real company as a customer with source "internet" and stage new (only with a public phone, site or address; at most 20 per request; never invent).`,
  },
  retail: {
    label: 'Savdo', customer: { one: 'mijoz', many: 'mijozlar' }, pack: GENERAL_PACK, followDays: 2,
    playbook: `This is a shop or a small trade business. Customers ask about availability, price, delivery and returns. What usually needs attention: unanswered questions, orders started but not finished (follow up once), regular customers before holidays. Documents: a price list, an offer, a receipt or an invoice.`,
  },
};

const norm = (s: string) => s.toLowerCase().replace(/[‘’ʻʼ`]/g, "'");
const EDUCATION = /o'quv|ta'lim|maktab|kurs\b|kurslar|repetitor|akademiya|bog'cha|litsey|ielts|learning|education|school|учеб|школ|курс|образов|репетит|детск(ий)? сад/;
const MANUFACTURING = /zavod|fabrika|ishlab chiqar|ishlab-chiqar|\bsex\b|ulgurji|optom|производ|завод|фабрик|\bцех|оптов/;
const SERVICES = /(^|\W)it(\W|$)|dastur|agentlik|xizmat|konsalting|marketing|reklama|dizayn|yurist|buxgalter|qurilish|ta'mir|logistika|услуг|агентств|консалт|разработ|ремонт|строит|юрид|бухгалт/;

/** Boshqa bizneslarga dastur yoki xizmat sotadi (mijozlari klinika bo'lsa ham o'zi klinika emas) */
const SELLS_TO = /(^|\W)it(\W|$)|dastur|software|crm|uchun ai|ai yordamchi|agentlik|для клиник|программ|разработ/;

/** Soha profili: DentaCRM ulangan yoki tibbiyot — klinika; qolgani soha nomidagi so'zlardan; bilinmasa — savdo */
export function industryOf(industry: string, clinic = false): IndustryProfile {
  const t = norm(industry);
  // «Klinikalar uchun IT» — xizmat: klinika so'zi bor, lekin bu klinikaga sotuvchi (DentaCRM ulangan bo'lsa — baribir klinika)
  const kind: IndustryKind = clinic ? 'clinic'
    : SELLS_TO.test(t) ? 'services'
    : isMedical(industry) ? 'clinic'
    : EDUCATION.test(t) ? 'education'
    : MANUFACTURING.test(t) ? 'manufacturing'
    : SERVICES.test(t) ? 'services'
    : 'retail';
  return { kind, ...PROFILES[kind] };
}

export const COMMON_RULES = COMMON_PLAYBOOK;
/** Biznesning tayyor savollari: klinika (tibbiyot yoki DentaCRM ulangan), o'quv markazi, xizmat, ishlab chiqarish, savdo */
export const packFor = (industry: string, clinic: boolean): PackQuestion[] => industryOf(industry, clinic).pack;
/** Hamma sohalarning tayyor savollari (anketadagi javob qaysi ro'yxatdan ekanini topish uchun) */
export const ALL_PACKS: PackQuestion[] = [...CLINIC_PACK, ...GENERAL_PACK, ...EDUCATION_PACK, ...SERVICES_PACK, ...MANUFACTURING_PACK];
