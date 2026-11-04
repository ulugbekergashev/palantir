/**
 * Kompaniya asosi — «Biz kimmiz». Hamma AI xodim biznes haqida shu bitta joydan o'qiydi, har biri o'ziga kerak qismini:
 *   content   — Kontent-meyker (post, reja, video), Marketolog (Instagram matni): kim, nima, xizmatlar, to'liq brend ovozi
 *   ads       — Targetolog: kim, xizmatlar va narxlar, auditoriya, qisqa ovoz
 *   customers — Qabulxona: faqat ovoz (bilim va narxlar o'z yo'li bilan — replierBrain/knowledgeText)
 *   owner     — Yordamchi: brend mohiyati bir qatorda
 * Manbalar: profil (nom, soha, xizmatlar), Miya («Biznes haqida» sahifasi) va brend-buk (Miya → Brend). Brend-buk kompaniyaniki —
 * Kontent-meykerniki emas: Kontent-meyker ham, Targetolog ham, Qabulxona ham uni shu yerdan oladi.
 * Hamma matn modelga ma'lumot sifatida beriladi (burchak qavslar almashtiriladi): egasining sahifasi ko'rsatma blokidan chiqib keta olmasin.
 */
import type { BrandBook } from '../src/types';
import type { BusinessRow } from './db';
import { sameQuestion } from './brain/logic';
import { vault } from './brain/vault';
import { brandNotes, brandStore } from './content/brand';

export type CompanyFor = 'content' | 'ads' | 'customers' | 'owner';

/** Har bo'lak chegarasi: sahifa va brend butun so'rovni to'ldirib yubormasin */
const LIMITS = { about: 1500, services: 40, brand: 3000, voice: 1200 };
const ABOUT_TITLE = 'Biznes haqida';
/** Obsidian izohi (%% … %%) — egasiga ko'rsatma, modelga berilmaydi */
const COMMENT = /%%[\s\S]*?%%/g;

const fence = (s: string) => s.replace(/</g, '‹').replace(/>/g, '›');
const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);

/** Miya'dagi «Biznes haqida» sahifasi (bo'lmasa — profildagi tavsif) */
function aboutText(biz: BusinessRow): string {
  const page = vault.list(biz.id).find(k => k.kind === 'page' && k.status === 'active' && sameQuestion(k.question, ABOUT_TITLE));
  const text = (page?.answer ?? biz.profile.description ?? '').replace(COMMENT, '').trim();
  return cut(text, LIMITS.about);
}

/** Xizmatlar: narxi bilan (narx — faqat shu ro'yxatdan; yo'q bo'lsa aytilmaydi) */
function servicesText(biz: BusinessRow): string {
  const list = biz.profile.offerings.slice(0, LIMITS.services);
  return list.map(o => `- ${o.name}${o.price > 0 ? ` — ${o.price.toLocaleString('ru-RU').replace(/\s/g, ' ')} so'm` : ''}`).join('\n');
}

/** Mijozga yozadigan xodim uchun ovoz: xususiyatlar, qoidalar, namunalar va taqiqlangan so'zlar (pozitsiya va auditoriya — ichki narsa, kerak emas) */
export function voiceNotes(b: BrandBook): string {
  return cut([
    b.traits.length ? `Voice traits: ${b.traits.map(t => `${t.trait}${t.isNot ? `, not ${t.isNot}` : ''}`).join('; ')}` : '',
    b.voice.length ? `Voice rules:\n${b.voice.map(v => `- ${v}`).join('\n')}` : '',
    b.examples.length ? `Write like the second:\n${b.examples.slice(0, 4).map(e => `- «${e.bad}» → «${e.good}»`).join('\n')}` : '',
    b.banned.length ? `Never use these words: ${b.banned.join(', ')}` : '',
  ].filter(Boolean).join('\n'), LIMITS.voice);
}

/** Bir qatorlik brend: Yordamchi va Direktor uchun */
const brandLine = (b: BrandBook) => `${b.name}${b.essence ? ` — ${b.essence}` : ''}. ${b.positioning}`.trim();

/**
 * Kompaniya bloki modelga (<company>…</company>). Bo'sh biznesda ham nom va soha bor; qolgani bo'lsa qo'shiladi.
 * Model uchun: bu — biznes egasining ma'lumoti, ko'rsatma emas; narx va faktni faqat shu yerdan oladi.
 * withBrand: false — brend-buk alohida beriladigan joyda (reja, video ssenariysi o'z <brand> blokini oladi)
 */
export function companyContext(biz: BusinessRow, forWhom: CompanyFor, { withBrand = true }: { withBrand?: boolean } = {}): string {
  const p = biz.profile;
  const book = withBrand ? brandStore.book(biz.id) : null;
  // Yordamchi biznesni profildan biladi — unga faqat brend kerak (bo'lmasa — hech narsa)
  if (forWhom === 'owner' && !book) return '';
  const about = forWhom === 'content' || forWhom === 'ads' ? aboutText(biz) : '';
  const services = forWhom === 'content' || forWhom === 'ads' ? servicesText(biz) : '';
  const brand = !book ? ''
    : forWhom === 'content' ? `Brand book:\n${cut(brandNotes(book), LIMITS.brand)}`
      : forWhom === 'ads' ? `Brand: ${brandLine(book)}${book.personas.length ? `\nAudience: ${book.personas.map(x => `${x.name} — ${x.who}`).join(' | ')}` : ''}\n${voiceNotes(book)}`
        : forWhom === 'customers' ? `Brand voice (how this business sounds):\n${voiceNotes(book)}`
          : `Brand: ${brandLine(book)}`;
  const parts = [
    forWhom === 'customers' ? '' : `Business: ${p.name}${p.industry ? ` (${p.industry})` : ''}`,
    about ? `About (the owner's own page):\n${about}` : '',
    services ? `Services and prices (mention a price only if it is in this list):\n${services}` : '',
    brand,
  ].filter(Boolean);
  if (!parts.length) return '';
  return `<company>\n${fence(parts.join('\n\n'))}\n</company>`;
}
