/**
 * Kamera yopildi yoki burildi — sof qoida. Dvigatel har kadrdan kichik iz yuboradi (yorug'lik, kontrast, 32×18 kulrang rasm);
 * bu yerda u kameraning odatiy ko'rinishi (asta yangilanadigan namuna) bilan solishtiriladi.
 *   yopildi — kadr deyarli bir xil rangda yoki juda qorong'i (qo'l, mato, lenta, qora kadr, chiroq o'chgan va kamerada tungi
 *     yorug'lik yo'q). Qorong'i shovqinli kadr «burildi» deb aytilmaydi — u ham shu tur;
 *   burildi — kadr odatiy ko'rinishga umuman o'xshamaydi (kamera boshqa tomonga qaragan yoki joyi o'zgargan).
 * Holat holdMs davomida uzluksiz bo'lsa — bir marta aytiladi; holdMs davomida yana odatdagidek bo'lsa — «yana ko'ryapti» (bitta
 * yaxshi kadr tuzalish emas). Ish vaqtidan tashqarida qorong'i kadr (chiroq o'chgan) hukm qilinmaydi. Taqqoslash yorug'lik o'zgarishiga
 * (kun/kech, chiroq) sezgir emas: o'rtachasi ayirilgan va me'yorlangan rasmlar solishtiriladi. Kadrlarning o'zi saqlanmaydi.
 */
import type { Look } from './wire';

export type TamperKind = 'covered' | 'moved';
/**
 * ref — odatiy ko'rinish namunasi (birinchi ko'rinadigan kadrdan: qorong'ida yoqilgan kamera qora kadrni «odatiy» deb olmasin),
 * startedAt — o'rganish boshlangan payt; badSince — muammo qachondan beri; goodSince — aytilgan muammodan keyin qachondan beri
 * yana odatdagidek; told — egasiga aytilgan muammo
 */
export interface TamperState { ref: number[] | null; startedAt: number; kind: TamperKind | null; badSince: number | null; goodSince: number | null; told: TamperKind | null }
export type TamperEvent = { type: TamperKind | 'restored'; similarity: number };
/** darkOk — ish vaqtidan tashqari: qorong'i kadr (chiroq o'chgan) normal, hukm qilinmaydi */
export interface TamperOpts { warmupMs: number; holdMs: number; darkOk?: boolean }

/** Kontrast shundan past — kadr bir xil rangda; o'rtacha yorug'lik shundan past — juda qorong'i */
const COVER_STD = 6, DARK_MEAN = 30;
/** O'xshashlik shundan past — boshqa manzara */
const MOVED_SIM = 0.45;
/** Namuna faqat kadr unga yetarlicha o'xshasa yangilanadi (burilgan kameraning yangi manzarasi «odatiy» bo'lib qolmasin) */
const ADAPT_SIM = 0.8;
const ALPHA_WARM = 0.2, ALPHA = 0.02;

/** Ikki kichik rasmning o'xshashligi (−1..1): o'rtachasi ayirilib, me'yorlangan ko'paytma — yorug'lik va kontrast farqi ta'sir qilmaydi */
export function similarity(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  let ab = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; ab += x * y; aa += x * x; bb += y * y; }
  return aa && bb ? ab / Math.sqrt(aa * bb) : 0;
}

const blend = (ref: readonly number[], next: readonly number[], alpha: number) => ref.map((v, i) => v + (next[i] - v) * alpha);

/** Bitta kadr izi: yangi holat va (bo'lsa) egasiga aytiladigan hodisa. Birinchi kadrlar (warmupMs) — odatiy ko'rinishni o'rganish */
export function judgeLook(s: TamperState | undefined, look: Look, now: number, o: TamperOpts): { next: TamperState; event: TamperEvent | null } {
  const dark = look.mean < DARK_MEAN, covered = look.std < COVER_STD || dark;
  const was: TamperState = s && (!s.ref || s.ref.length === look.thumb.length) ? s : { ref: null, startedAt: now, kind: null, badSince: null, goodSince: null, told: null };
  // Yopilgandan keyin qorong'i xona — kutilgan holat: na muammo, na tuzalish (ertalab chiroq yonsa, odatdagi tekshiruv davom etadi)
  if (dark && o.darkOk) return { next: { ...was, kind: null, badSince: null }, event: null };
  // Odatiy ko'rinish hali yo'q: birinchi ko'rinadigan kadr — namuna, o'rganish shundan boshlanadi
  if (!was.ref && !covered) return { next: { ...was, ref: [...look.thumb], startedAt: now }, event: null };
  const sim = covered || !was.ref ? 0 : similarity(look.thumb, was.ref);
  const warm = now - was.startedAt < o.warmupMs;
  const kind: TamperKind | null = covered ? 'covered' : !warm && sim < MOVED_SIM ? 'moved' : null;
  const ref = was.ref && !covered && (warm || sim >= ADAPT_SIM) ? blend(was.ref, look.thumb, warm ? ALPHA_WARM : ALPHA) : was.ref;
  if (!kind) {
    const goodSince = was.goodSince ?? now;
    const restored = !!was.told && now - goodSince >= o.holdMs;
    return { next: { ...was, ref, kind: null, badSince: null, goodSince: was.told && !restored ? goodSince : null, told: restored ? null : was.told }, event: restored ? { type: 'restored', similarity: sim } : null };
  }
  const badSince = was.kind === kind && was.badSince != null ? was.badSince : now;
  const due = was.told !== kind && now - badSince >= o.holdMs;
  return { next: { ...was, ref, kind, badSince, goodSince: null, told: due ? kind : was.told }, event: due ? { type: kind, similarity: sim } : null };
}
