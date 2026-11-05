/**
 * AI jamoa tarkibi — kim ishga olingan. Server ham, panel ham shu qoidadan foydalanadi.
 *
 * Standart jamoa — Direktor va Yordamchi (asosiy: olib tashlanmaydi). Qolgan xodimlar:
 *   - egasi «+ Xodim qo'shish» sahifasida o'zi ishga oladi;
 *   - yoki xodimning ishi allaqachon ulangan bo'lsa (Instagram ulandi — Qabulxona, kamera qo'shildi — Kuzatuvchi), o'zi qo'shiladi,
 *     egasi uni o'zi olib tashlamagan bo'lsa.
 * Ikki xil savol:
 *   - jamoada bormi (menyu, bosh ekran, Direktor taklifi) — faqat ishga olingani;
 *   - fonda ishlaydimi — egasi o'zi olib tashlamagan bo'lsa ishlaydi (Qabulxona javob tayyorlaydi, kamera xabar beradi …).
 *     Hali «ishga olinmagan», lekin kanali ulanib ulgurgan xodim ham ishlaydi: panel ochilmasdan kelgan birinchi mijoz javobsiz qolmasin
 *     (panel ochilganda u jamoaga o'zi qo'shiladi).
 */

export const CREW = ['direktor', 'qabulxona', 'yordamchi', 'kuzatuvchi', 'tahlilchi', 'marketolog', 'kontent', 'target'] as const;
export type CrewMember = typeof CREW[number];
/** Asosiy xodimlar: har biznesda bor, olib tashlanmaydi */
export const CORE: readonly CrewMember[] = ['direktor', 'yordamchi'];

/** hired — egasi olgan yoki ishi ulangani uchun o'zi qo'shilgan; dismissed — egasi o'zi olib tashlagan (o'zi qaytib qo'shilmaydi) */
export interface CrewState { hired: CrewMember[]; dismissed: CrewMember[] }

export const isCrewMember = (v: unknown): v is CrewMember => typeof v === 'string' && (CREW as readonly string[]).includes(v);
export const isCore = (m: CrewMember): boolean => CORE.includes(m);

const only = (v: unknown): CrewMember[] => (Array.isArray(v) ? CREW.filter(m => v.includes(m) && !isCore(m)) : []);

/** Bazadagi JSON. null — hali hisoblanmagan (eski baza yoki yangi biznes, panel hali ochilmagan) */
export function parseCrew(raw: string | null): CrewState | null {
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<CrewState>;
    return { hired: only(s?.hired), dismissed: only(s?.dismissed) };
  } catch {
    return null;
  }
}

/** Ishdagi jamoa — doim CREW tartibida, asosiylari bilan */
export const crewList = (s: CrewState | null): CrewMember[] => CREW.filter(m => isCore(m) || !!s?.hired.includes(m));

/** Ishi ulangan xodimlarni qo'shadi (egasi olib tashlaganlaridan tashqari). Hech narsa o'zgarmasa — o'sha holat */
export function withInUse(s: CrewState | null, inUse: readonly CrewMember[]): CrewState {
  const base = s ?? { hired: [], dismissed: [] };
  const add = inUse.filter(m => !isCore(m) && !base.hired.includes(m) && !base.dismissed.includes(m));
  return add.length || !s ? { hired: CREW.filter(m => base.hired.includes(m) || add.includes(m)), dismissed: base.dismissed } : s;
}

/** Ishga olish (on) yoki olib tashlash. Asosiy xodimni olib tashlab bo'lmaydi */
export function setHired(s: CrewState | null, m: CrewMember, on: boolean): CrewState {
  const base = s ?? { hired: [], dismissed: [] };
  if (isCore(m)) return base;
  return on
    ? { hired: CREW.filter(x => x === m || base.hired.includes(x)), dismissed: base.dismissed.filter(x => x !== m) }
    : { hired: base.hired.filter(x => x !== m), dismissed: CREW.filter(x => x === m || base.dismissed.includes(x)) };
}

/** Fonda ishlaydimi: egasi olib tashlamagan bo'lsa. Holat hali hisoblanmagan (null) — hammasi ishlaydi: eski bazada avvalgidek */
export const works = (s: CrewState | null, m: CrewMember): boolean => isCore(m) || !s || !s.dismissed.includes(m);
/** Jamoada bormi (ishga olingan). Holat hali hisoblanmagan (null) — hammasi bor: eski bazada avvalgidek */
export const hiredIn = (s: CrewState | null, m: CrewMember): boolean => isCore(m) || !s || s.hired.includes(m);

/** Bazadagi biznes yozuvi bo'yicha (server): fonda ishlash ruxsati — olib tashlangan xodim mijozga javob bermaydi, kamera xabarini yubormaydi */
export const crewWorks = (biz: { crew: string | null }, m: CrewMember): boolean => works(parseCrew(biz.crew), m);
/** Bazadagi biznes yozuvi bo'yicha (server): jamoada bormi — Direktor faqat shularga topshiriq taklif qiladi */
export const crewHas = (biz: { crew: string | null }, m: CrewMember): boolean => hiredIn(parseCrew(biz.crew), m);

/**
 * Qaysi xodimning ishi allaqachon ulangan — ular jamoaga o'zi qo'shiladi.
 * Eski bazada (yangilanishdan oldin) shu bilan ishlatilayotgan xodimlar jamoada qoladi, ishlatilmaganlari ko'rinmaydi.
 */
export interface CrewSignals {
  /** Mijoz yozadigan kanal ulangan (Telegram biznes, Instagram) yoki mijozlar, qo'ng'iroqlar bor */
  customers: boolean;
  crm: boolean;
  cameras: number;
  metaAi: boolean;
  marketingPosts: number;
  content: boolean;
  ads: boolean;
}

export function inUse(s: CrewSignals): CrewMember[] {
  const on: Record<CrewMember, boolean> = {
    direktor: true, yordamchi: true,
    qabulxona: s.customers,
    tahlilchi: s.customers || s.crm,
    kuzatuvchi: s.cameras > 0,
    // Instagram postlarini Kontent-meyker yasaydi (oldin Marketologda edi): ularni ishlatgan bazada Kontent-meyker jamoada
    marketolog: s.metaAi,
    kontent: s.content || s.marketingPosts > 0,
    target: s.ads,
  };
  return CREW.filter(m => on[m]);
}
