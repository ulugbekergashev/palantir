/**
 * Telegram Mini App (bot → «Panel»): Telegram ishga tushirish ma'lumotini manzil oxirida #tgWebAppData=… bilan beradi.
 * U olinadi va manzildan o'chiriladi (panel o'zining #/ yo'nalishlari bilan ishlaydi) va shu ma'lumot bilan parolsiz kiriladi —
 * eski kirish bekor qilingan bo'lsa ham yangisi olinadi. Tasdiq o'tmasa (egasi emas) — oddiy kirish sahifasi qoladi.
 */
import { api, session } from '../data/api';

export async function telegramLaunch(): Promise<void> {
  const initData = new URLSearchParams(window.location.hash.slice(1)).get('tgWebAppData');
  if (!initData) return;
  window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#/`);
  try {
    session.set((await api.telegramLogin(initData)).token);
  } catch {
    /* parol bilan kirish qoladi */
  }
}
