/**
 * Tayyor kirish bilan ochilgan panel:
 *  - Telegram Mini App (bot → «Panel»): Telegram ishga tushirish ma'lumotini manzil oxirida #tgWebAppData=… bilan beradi —
 *    shu ma'lumot bilan parolsiz kiriladi (eski kirish bekor qilingan bo'lsa ham yangisi olinadi). Tasdiq o'tmasa (egasi emas) —
 *    oddiy kirish sahifasi qoladi;
 *  - Palantir Hub'dagi «Panelni ochish» (jamoa): #kirish=<kalit> — klinika bergan kalit faqat shu oynada saqlanadi.
 * Ikkalasi ham manzildan o'chiriladi (panel o'zining #/ yo'nalishlari bilan ishlaydi).
 */
import { api, session } from '../data/api';

export async function telegramLaunch(): Promise<void> {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const initData = params.get('tgWebAppData'), given = params.get('kirish');
  if (!initData && !given) return;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
  if (given) return session.setTab(given);
  try {
    session.set((await api.telegramLogin(initData!)).token);
  } catch {
    /* parol bilan kirish qoladi */
  }
}
