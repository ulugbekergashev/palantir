/**
 * Topshiriqlarni bajarish. Har yarim daqiqada:
 *   schedule — vaqti kelgan topshiriq yordamchiga beriladi (asboblari bilan bajaradi), natija suhbatga va egasining Telegram'iga;
 *   look — AI ko'zi: vaqti kelgan (soatda yoki har N daqiqada) kameralarning kadri tekshiriladi; muammo bo'lsa — jurnal va Telegram.
 * Kamera qoidalari (watch) bu yerda emas — har kadrda (watch.ts). Server qisqa to'xtagan bo'lsa, CATCH_UP_MS ichida o'tib ketgan vaqt
 * baribir bajariladi; undan eskisi — o'tkaziladi (kechagi eslatma bugun kelmasin).
 */
import type { AgentOrder } from '../../src/types';
import { iso } from '../../src/lib/week';
import { ask } from '../agent';
import type { BotService } from '../bot';
import { businesses, cameras, type BusinessRow } from '../db';
import { notifyOwner } from '../inbox/core';
import { cameraFrame, onCameraFrame } from '../camera/routes';
import { waitFrame } from '../camera/waiting';
import { checkFrame } from './look';
import { events, orders } from './store';
import { dueAt, dueEvery } from './logic';
import { watchFrame } from './watch';

const TICK_MS = Number(process.env.ORDERS_TICK_MS) || 30_000;
/** Bajarilmagan ish (internet, AI chegarasi) shundan keyin qayta uriniladi — vaqti o'tib ketmagan bo'lsa */
const RETRY_MS = 5 * 60_000;
const NAMES: Record<AgentOrder['member'], string> = { qabulxona: 'Qabulxona', yordamchi: 'Yordamchi', kuzatuvchi: 'Kuzatuvchi', tahlilchi: 'Tahlilchi' };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Jadvaldagi ish: yordamchi bajaradi (suhbatda ham ko'rinadi), natija — Telegram'ga */
export async function runScheduled(bot: BotService, biz: BusinessRow, o: AgentOrder): Promise<string> {
  const prompt = `⏰ Jadvaldagi topshiriq (${NAMES[o.member]} uchun, egasi bergan): ${o.text}\nHozir bajaring va natijani qisqa yozing.`;
  // Egasi kuzatmayapti: bilimga va CRM'ga yozadigan asboblar ishlamaydi (mijozlar matni o'qilsa ham, u buyruq bo'lib qolmasin)
  const reply = await ask(biz.id, 'web', prompt, { display: `⏰ ${NAMES[o.member]}: ${o.text}`, unattended: true });
  if (reply.failed) throw new Error(reply.text);
  orders.ran(o.id, reply.text);
  events.add(biz.id, { member: o.member, orderId: o.id, level: 'info', title: `Bajarildi: ${o.text.slice(0, 120)}`, body: reply.text, cameraId: null });
  if (bot.enabled && biz.ownerChatId) await bot.deliverReply(biz, `⏰ ${o.text}\n\n${reply.text}`, reply.artifacts).catch(e => console.error('[topshiriq] Telegram:', (e as Error).message));
  return reply.text;
}

/** AI ko'zi: topshiriqdagi kameralar kadrini tekshiradi. Muammo bo'lsa — jurnal (kadr bilan) va Telegram. quiet — oddiy natija jurnalga yozilmaydi */
export async function runLook(biz: BusinessRow, o: AgentOrder, quiet: boolean): Promise<string> {
  if (o.spec.kind !== 'look') return '';
  const spec = o.spec;
  const list = cameras.list(biz.id).filter(c => (spec.cameraId ? c.id === spec.cameraId : true) && c.ip);
  if (!list.length) { orders.ran(o.id, "IP kamera yo'q — kadr olinmadi"); return "IP kamera yo'q — kadr olinmadi"; }
  const said: string[] = [];
  for (const cam of list) {
    const frame = await cameraFrame(biz.id, cam.id);
    if (!frame) { said.push(`${cam.name}: kadr olinmadi`); continue; }
    const r = await checkFrame(biz.id, cam, spec.question, frame);
    said.push(`${cam.name}: ${r.answer}`);
    if (r.alert) {
      events.add(biz.id, { member: 'kuzatuvchi', orderId: o.id, level: 'warn', title: `${cam.name}: ${o.text.slice(0, 120)}`, body: r.answer, cameraId: cam.id }, frame);
      await notifyOwner(biz, `👁 <b>${esc(cam.name)}</b> — ${esc(r.answer)}\n<i>Topshiriq: ${esc(o.text)}</i>`).catch(() => {});
    } else if (!quiet) {
      events.add(biz.id, { member: 'kuzatuvchi', orderId: o.id, level: 'info', title: `${cam.name}: tekshirildi`, body: r.answer, cameraId: cam.id }, frame);
    }
  }
  const result = said.join('\n');
  orders.ran(o.id, result);
  return result;
}

export function startOrders(bot: BotService): () => void {
  onCameraFrame((biz, cam, people, now) => watchFrame(biz, cam, people, now, (b, html) => notifyOwner(b, html), () => cameraFrame(biz.id, cam.id)));
  // Kutish joyi: kimdir uzoq kutsa — jurnalga (kadr bilan) va egasiga
  onCameraFrame((biz, cam, people, now) => waitFrame(biz, cam, people, now, (b, c, zone, minutes) => {
    const title = `${c.name} · ${zone.name}: bir kishi ${minutes} daqiqadan beri kutyapti`;
    void cameraFrame(b.id, c.id).then(image => {
      events.add(b.id, { member: 'kuzatuvchi', orderId: null, level: 'warn', title, body: "Kutish joyida uzoq kutish — kimdir uni qabul qilsin yoki nima bo'lganini aytsin", cameraId: c.id }, image);
      return notifyOwner(b, `⏳ <b>${esc(title)}</b>\nQabulxonaga ayting: bemorni qabul qilsin yoki kechikish sababini aytsin.`);
    }).catch(e => console.error('[kuzatuvchi] kutish xabari:', (e as Error).message));
  }));
  const busy = new Set<string>();
  const retryAt = new Map<string, number>();
  /** Bajarilmagani jurnalga kuniga bir marta (har urinishda emas) */
  const failedDay = new Map<string, string>();
  let pruned = '';
  const tick = () => {
    const now = new Date();
    if (pruned !== iso(now)) { pruned = iso(now); events.prune(); }
    for (const o of orders.active()) {
      if (busy.has(o.id) || (retryAt.get(o.id) ?? 0) > now.getTime()) continue;
      // Soatli ish yaratilgan kuni o'tib ketgan vaqt uchun darhol bajarilmasin: hisob yaratilgan paytdan
      const since = o.lastRunAt ?? o.createdAt;
      const due = o.spec.kind === 'schedule' ? dueAt(o.spec.at, o.spec.days, since, now) : o.spec.kind === 'look' ? dueEvery(o.spec, o.spec.at ? since : o.lastRunAt, now) : false;
      if (!due) continue;
      const biz = businesses.byId(o.businessId);
      if (!biz?.active) continue;
      busy.add(o.id);
      // Vaqtidagi ish (schedule, soatli look) — natijasi jurnalga; har N daqiqalik qarash — faqat muammo bo'lsa
      const work = o.spec.kind === 'schedule' ? runScheduled(bot, biz, o) : runLook(biz, o, !(o.spec.kind === 'look' && o.spec.at));
      work.then(() => { retryAt.delete(o.id); }, e => {
        const reason = (e as Error).message;
        orders.failed(o.id, reason);
        retryAt.set(o.id, Date.now() + RETRY_MS);
        if (failedDay.get(o.id) !== iso(now)) {
          failedDay.set(o.id, iso(now));
          events.add(biz.id, { member: o.member, orderId: o.id, level: 'warn', title: `Bajarilmadi: ${o.text.slice(0, 120)}`, body: reason, cameraId: null });
        }
        console.error(`[topshiriq] ${o.id}:`, reason);
      }).finally(() => busy.delete(o.id));
    }
  };
  const t = setInterval(tick, TICK_MS);
  t.unref();
  return () => clearInterval(t);
}
