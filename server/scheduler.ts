/**
 * Har daqiqada: (1) dushanba 09:00 dan keyin shu haftaning paketi hali
 * yuborilmagan klinikalarga yuboradi, (2) vaqti kelgan tasdiqlangan postlarni
 * joylaydi. Server o'chib qolgan bo'lsa, yoqilgach o'tkazib yuborilganini bajaradi.
 */
import { packageDue, type BotService } from './bot';
import { clinics } from './db';
import { thisMonday } from './content';
import { env } from './env';

export function startScheduler(bot: BotService): () => void {
  if (!bot.enabled) return () => {};
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = new Date();
      for (const clinic of clinics.all()) {
        if (!packageDue(clinic, now)) continue;
        try {
          await bot.sendPackage(clinic, thisMonday(now));
          console.log(`[jadval] paket yuborildi: ${clinic.profile.name}`);
        } catch (e) {
          console.error(`[jadval] paket yuborilmadi (${clinic.profile.name}):`, (e as Error).message);
        }
      }
      await bot.publishDue(now);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => { void tick(); }, env.tickMs);
  void tick();
  return () => clearInterval(timer);
}
