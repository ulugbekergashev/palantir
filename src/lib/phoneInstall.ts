/** Telefon xizmatini o'rnatish holati panelda (server/voice/phoneInstall.ts) — ustaning Telefon qadami va Sozlamalar → Telefon liniyasi */
import type { PhoneLine } from '../data/api';

/** Tugma bosilgandan keyingi xabar: shu kompyuterda — oyna ochildi; Hub orqali — ekranda hech narsa ochilmaydi */
export const installStartedText = (remote?: boolean): string => remote
  ? "O'rnatish boshlandi — 5–15 daqiqa, klinika ekranida hech narsa ochilmaydi. Holat shu yerda yangilanadi"
  : "O'rnatish oynasi ochildi — undagi ko'rsatmalarga amal qiling";

/** Oxirgi o'rnatish haqida bitta qator; ko'rsatadigan narsa bo'lmasa — null (o'rnatilmagan yoki allaqachon ishlayapti) */
export function installStateText(i: PhoneLine['install'], asteriskUp: boolean): string | null {
  if (!i) return null;
  if (i.phase === 'running') return `Telefon xizmati o'rnatilyapti${i.step ? ` — ${i.step}` : ''}…`;
  if (i.phase === 'rebooted') return "Kompyuter qayta yondi — o'rnatish davom etyapti…";
  // Xizmat ishlayapti — eski «o'rnatilmadi» / «qayta yoqish kerak» endi ahamiyatsiz (masalan, keyin qo'lda o'rnatilgan)
  if (asteriskUp) return null;
  if (i.phase === 'reboot') return "WSL yoqildi — kompyuterni qayta yoqish kerak. Yonganidan keyin o'rnatish o'zi davom etadi";
  if (i.phase === 'failed') return `O'rnatilmadi${i.step ? ` («${i.step}» qadamida)` : ''}: ${i.note}`;
  if (i.phase === 'stalled') return "O'rnatish to'xtab qolgan — qayta bosing, qolgan joyidan davom etadi";
  return "Telefon xizmati o'rnatilgan, lekin hozir javob bermayapti — kompyuterni qayta yoqing";
}
