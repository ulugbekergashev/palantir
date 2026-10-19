/**
 * Kamera qoidalari («watch» topshiriqlari): odam topuvchi har kadrda sanagan odamlar bo'yicha. Shart `minutes` davomida uzluksiz
 * bajarilsa — jurnalga (kadr bilan) va egasining Telegram'iga. Bir holat uchun bitta xabar: shart buzilmaguncha qayta aytilmaydi,
 * uzoq davom etsa — REPEAT_MS dan keyin yana bir marta. Kadr kelmasa (kamera o'chgan) hech narsa sanalmaydi — «bo'sh» deb xato aytilmaydi.
 */
import type { Camera } from '../../src/types';
import type { BusinessRow } from '../db';
import type { Box } from '../camera/sessions';
import { conditionHolds, countIn, inWindow, judge, whatHappened, type Hold } from './logic';
import { events, orders } from './store';

export type Alert = (biz: BusinessRow, html: string, image: Buffer | null) => Promise<unknown>;

const holds = new Map<string, Hold>();
/** Har kameraning oxirgi kadri: qachon va odamlar qayerda (topshiriqni sinash va «hozir nechta odam» uchun) */
const lastFrame = new Map<string, { at: number; people: Box[] }>();
export const frameState = (cameraId: string) => lastFrame.get(cameraId) ?? null;
let cache: { at: number; list: ReturnType<typeof orders.active> } = { at: 0, list: [] };
/** Topshiriqlar ro'yxati har kadrda bazadan o'qilmaydi (kadr har 2 soniyada, kamera ko'p) */
const CACHE_MS = 5_000;
/** Kameradan shuncha vaqt kadr kelmagan bo'lsa — uning holatlari eskirgan (uzilishdan keyin «darhol» xabar bo'lmasin) */
const GAP_MS = 30_000;
const dropHolds = (match: (key: string) => boolean) => { for (const k of [...holds.keys()]) if (match(k)) holds.delete(k); };
/** Topshiriqlar o'zgardi: ro'yxat qayta o'qiladi; o'zgargan topshiriqning holati unutiladi */
export const forgetWatchCache = (orderId?: string): void => {
  cache = { at: 0, list: [] };
  if (orderId) dropHolds(k => k.startsWith(`${orderId}|`));
};

export function watchFrame(biz: BusinessRow, cam: Camera, people: Box[], now: number, alert: Alert, frame: () => Promise<Buffer | null>): void {
  const before = lastFrame.get(cam.id);
  if (before && now - before.at > GAP_MS) dropHolds(k => k.endsWith(`|${cam.id}`));
  lastFrame.set(cam.id, { at: now, people });
  if (now - cache.at > CACHE_MS) cache = { at: now, list: orders.active() };
  const at = new Date(now);
  for (const o of cache.list) {
    if (o.businessId !== biz.id || o.spec.kind !== 'watch') continue;
    const spec = o.spec;
    if (spec.cameraId && spec.cameraId !== cam.id) continue;
    const key = `${o.id}|${cam.id}`;
    const count = countIn(cam, spec.zoneId, people);
    const ok = inWindow(spec.from, spec.to, at) && conditionHolds(spec.condition, count, spec.people);
    const r = judge(holds.get(key), ok, now, spec.minutes);
    if (r.next) holds.set(key, r.next); else holds.delete(key);
    if (!r.fire) continue;
    const zone = spec.zoneId ? cam.zones.find(z => z.id === spec.zoneId) : null;
    const title = whatHappened(spec, count, zone ? `${cam.name} · ${zone.name}` : cam.name);
    orders.ran(o.id, title);
    void frame().then(image => {
      events.add(biz.id, { member: 'kuzatuvchi', orderId: o.id, level: spec.condition === 'presence' ? 'crit' : 'warn', title, body: `Topshiriq: «${o.text}»`, cameraId: cam.id }, image);
      return alert(biz, `📷 <b>${esc(title)}</b>\n<i>Topshiriq: ${esc(o.text)}</i>`, image);
    }).catch(e => console.error('[kuzatuvchi] xabar:', (e as Error).message));
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
