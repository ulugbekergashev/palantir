/**
 * Ruxsatlar jadvali — AI jamoa nima qila oladi, bitta joyda (g'oya: Telegram Dictator'ning «Allow / Ask / Never»; 2026-11-20).
 * Har amal uchun egasi uch darajadan birini tanlaydi:
 *   allow — o'zi bajaradi (bugungidek);
 *   ask   — bajarishdan oldin egasidan Telegram'da (yoki panelda) «✅ Ha / ✖️ Yo'q» bilan so'raydi; «Ha» bosilsa — Palantir o'zi bajaradi;
 *   never — bajarmaydi, egasiga jadvalda yopilganini aytadi.
 * Jadval faqat QO'SHIMCHA cheklov: kodning doimiy himoyalari (pul zonasi — computer/money.ts, saytda «yuborish/saqlash» oldidan so'rash,
 * begona matn bilimga yozilmasligi) «Ruxsat» tanlansa ham o'z joyida. Standart — bugungi xatti-harakat (hamma «Ruxsat»).
 * Server ham (server/permissions.ts — asbob chaqirilishida tekshiradi), panel ham (Sozlamalar → Ruxsatlar) shu ro'yxatdan foydalanadi.
 */
import type { CrewMember } from './crew';

export type PermLevel = 'allow' | 'ask' | 'never';
export const PERM_LEVELS: readonly PermLevel[] = ['allow', 'ask', 'never'];

export const PERM_LABEL: Record<PermLevel, string> = { allow: 'Ruxsat', ask: "So'rasin", never: 'Hech qachon' };

const ALL: readonly PermLevel[] = PERM_LEVELS;
/** Allaqachon faqat qoralama bo'ladigan ish (yuborish/joylashni egasi baribir o'zi bosadi): «So'rasin» ortiqcha savol bo'lardi */
const DRAFT_ONLY: readonly PermLevel[] = ['allow', 'never'];

export interface PermAction {
  id: string;
  /** Jadvalda qaysi xodim ostida turadi */
  member: CrewMember;
  title: string;
  hint?: string;
  /** Shu amalga kiradigan asboblar (server/tools.ts dagi nomlar) */
  tools: readonly string[];
  /** Egasi tanlay oladigan darajalar */
  levels: readonly PermLevel[];
}

export const PERM_ACTIONS: readonly PermAction[] = [
  { id: 'tasks', member: 'yordamchi', title: "Vazifa va eslatma qo'shish, o'zgartirish", tools: ['create_task', 'update_task'], levels: ALL },
  { id: 'leads', member: 'yordamchi', title: "Mijoz kartasini qo'shish va o'zgartirish", tools: ['save_lead', 'update_lead'], levels: ALL },
  { id: 'memory', member: 'yordamchi', title: 'Bilimga yozish: fakt, narx, sahifa', hint: 'Mijozlarga javobda shu bilim ishlatiladi', tools: ['remember', 'forget', 'save_prices', 'write_page'], levels: ALL },
  { id: 'documents', member: 'yordamchi', title: 'Hujjat yozish', hint: 'Shartnoma, xat, buyruq…', tools: ['create_document'], levels: ALL },
  { id: 'requests', member: 'yordamchi', title: "Xodimlarga so'rov ochish va yopish", hint: "Masalan, «bemorga qo'ng'iroq qiling» kartasi", tools: ['open_request', 'close_request'], levels: ALL },
  { id: 'money_drafts', member: 'yordamchi', title: "To'lov va xarajat yozuvi (DentaCRM)", hint: 'Qoralama — yozishni siz tugma bilan tasdiqlaysiz', tools: ['record_payment', 'record_expense', 'pay_doctor'], levels: DRAFT_ONLY },
  { id: 'computer', member: 'yordamchi', title: 'Brauzerda ish bajarish', hint: "Saytda yuborish, saqlash va o'chirishdan oldin baribir so'raydi", tools: ['computer_task', 'play_media'], levels: ALL },
  { id: 'code', member: 'yordamchi', title: 'Dastur kodi bilan ishlash', tools: ['code_task', 'code_build'], levels: ALL },
  { id: 'followup', member: 'qabulxona', title: 'Mijozga xabar tayyorlash', hint: 'Yuborishni siz bosasiz', tools: ['draft_followup'], levels: DRAFT_ONLY },
  { id: 'booking', member: 'yordamchi', title: "Siz aytgan qabulni DentaCRM'ga yozish", hint: "Bemor yozishmada o'zi yozilishi — «Mijozlarga javob» rejimi bo'yicha", tools: ['book_appointment'], levels: ALL },
  { id: 'camera', member: 'kuzatuvchi', title: 'Kameraga qarash', tools: ['look_camera', 'camera_day', 'clinic_cameras'], levels: DRAFT_ONLY },
  { id: 'content', member: 'kontent', title: 'Post, kontent-reja, video va brend-buk tayyorlash', hint: 'Joylashni siz bosasiz', tools: ['content_drafts', 'draft_post', 'content_plan', 'content_video', 'content_brand_book'], levels: DRAFT_ONLY },
  { id: 'ads', member: 'target', title: 'Reklama rejasi va materiallarini tayyorlash', hint: "Ishga tushirish — sizning tugmangiz; to'xtatish doim ochiq", tools: ['ads_plan', 'ads_upload_media'], levels: DRAFT_ONLY },
  { id: 'meta_ai', member: 'marketolog', title: 'Meta AI bilan ishlash', tools: ['meta_ai'], levels: ALL },
  { id: 'vacancies', member: 'rekruter', title: 'Vakansiya ochish va yopish', tools: ['vacancy_create', 'vacancy_close'], levels: ALL },
  { id: 'trainings', member: 'murabbiy', title: 'Xodimga kurs boshlash', tools: ['training_start'], levels: ALL },
];

/** Jadvalda faqat ko'rsatiladigan, o'zgarmaydigan qoidalar (kodda qattiq) — egasi «AI nima qila olmaydi»ni bir joyda ko'rsin */
export const PERM_FIXED: readonly { title: string; level: PermLevel; why: string }[] = [
  { title: "Bank, to'lov, o'tkazma, xarid", level: 'never', why: 'Kodda yopiq — tugma bilan ham ochilmaydi' },
  { title: "Saytda «yuborish», «saqlash», «o'chirish» tugmalari", level: 'ask', why: "Har safar Telegram'da so'raydi" },
  { title: "Reklamani to'xtatish", level: 'allow', why: 'Pul egasiz qolmasin — doim ochiq' },
];

const BY_TOOL = new Map(PERM_ACTIONS.flatMap(a => a.tools.map(t => [t, a] as const)));
const BY_ID = new Map(PERM_ACTIONS.map(a => [a.id, a] as const));

/** Asbob qaysi amalga kiradi (jadvalda yo'q asbob — o'qish, holat… — null: doim ochiq) */
export const permActionOf = (tool: string): PermAction | null => BY_TOOL.get(tool) ?? null;
export const permAction = (id: string): PermAction | null => BY_ID.get(id) ?? null;

export const isPermLevel = (v: unknown): v is PermLevel => typeof v === 'string' && (PERM_LEVELS as readonly string[]).includes(v);

/** Egasi tanlagani; tanlamagan yoki endi ruxsat etilmagan daraja bo'lsa — standart «Ruxsat» */
export function levelFor(action: PermAction, chosen: Readonly<Record<string, string>>): PermLevel {
  const v = chosen[action.id];
  return isPermLevel(v) && action.levels.includes(v) ? v : 'allow';
}
