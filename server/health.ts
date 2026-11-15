/**
 * Chuqur sog'lik (/api/health?deep=1) — yangilovchi (scripts/update.mjs) yangi nashrni shunga qarab qabul qiladi yoki qaytaradi (H1).
 * Server ko'tarilgani yetmaydi: yangilashdan oldin AI va telefon AI ishlagan bo'lsa — yangi nashrda ham ishlashi shart.
 *   aiReady — AI so'rov yubora oladimi: obunada — Claude Code dasturi bor va obunaga kirilgan; API kalitda — kalit bor.
 *     So'rov yuborib tekshirilmaydi (pul/limit sarflanadi). AI o'chiq — null
 *   phoneAi — telefon liniyasining AI ovoz xizmati (tgvoice/sip_live.py) qo'ng'iroq qabul qilyaptimi. Liniya sozlanmagan — null
 * Oddiy /api/health tez qoladi: obuna holati (claude auth status) va port tekshiruvi faqat deep so'rovda.
 */
import { env } from './env';
import { obunaStatus } from './subscription/login';
import { subscriptionOn } from './subscription/engine';
import { aiListening, phoneConfigured } from './voice/line';

export interface DeepHealth { aiReady: boolean | null; phoneAi: boolean | null }

async function aiReady(): Promise<boolean | null> {
  if (!env.aiEnabled) return null;
  if (!subscriptionOn()) return true;
  const s = await obunaStatus().catch(() => null);
  return !!s?.available && s.loggedIn;
}

export async function deepHealth(): Promise<DeepHealth> {
  const [ai, phone] = await Promise.all([aiReady(), phoneConfigured() ? aiListening() : Promise.resolve(null)]);
  return { aiReady: ai, phoneAi: phone };
}
